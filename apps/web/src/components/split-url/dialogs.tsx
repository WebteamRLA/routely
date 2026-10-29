"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { HelpLink } from "@/components/common/help-link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  Spinner,
  XIcon,
} from "@/components/rt/icons";
import {
  ACCENT,
  ACCENT_INK,
  ACCENT_LINE,
  ACCENT_TINT,
  type SplitState,
} from "@/lib/mock/split-url";
import { cn } from "@/lib/utils";

import type { Derived } from "./model";
import { CodeIcon, RocketIcon, Swatch, cls } from "./ui";

const MONO = "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

/**
 * The design's dialog shell. Not the kit's `Modal`, whose built-in header and scrolling body
 * don't fit the install dialog's fixed-height, three-band layout. Radix supplies the focus trap,
 * Escape and aria wiring; `busy` ignores both while a launch is in flight, as the reference does.
 */
function Dialog({
  open,
  onClose,
  busy = false,
  width,
  labelledBy,
  describedBy,
  className,
  children,
}: {
  open: boolean;
  onClose(): void;
  busy?: boolean;
  width: number;
  labelledBy: string;
  describedBy?: string;
  className?: string;
  children: ReactNode;
}) {
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(17,24,39,.28)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <DialogPrimitive.Content
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault();
            }}
            className={cn(
              "relative flex w-full animate-[rt-dlg_.16s_ease-out] flex-col rounded-[16px] border border-[#E5E7EB] bg-white text-[14px] leading-[1.45] text-[#111827] shadow-[0_24px_64px_#1118272E] outline-none [&_button]:leading-[normal]",
              className,
            )}
            style={{ maxWidth: width }}
          >
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Buttons stretch to share the row on phones (`.rt-dlg-actions`). */
function Actions({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn("flex flex-wrap justify-end gap-2 max-[641px]:[&>button]:flex-auto", className)}
    >
      {children}
    </div>
  );
}

// --- Install tracking → verify ----------------------------------------------------------------

type RowLook = { iconBg: string; fg: string; kind: "ok" | "fail" | "running" | "pending" };
const OK: RowLook = { iconBg: "#DCFCE7", fg: "#166534", kind: "ok" };
const FAIL: RowLook = { iconBg: "#FEE2E2", fg: "#B91C1C", kind: "fail" };
const RUN: RowLook = { iconBg: ACCENT_TINT, fg: ACCENT_INK, kind: "running" };
const PEND: RowLook = { iconBg: "#F3F4F6", fg: "#9CA3AF", kind: "pending" };

const TIPS = [
  "Make sure your changes are published, not just saved as a draft.",
  "If you use a caching plugin or CDN, clear the cache and check again.",
  "Check that a cookie banner isn’t blocking the script until visitors accept.",
];

/**
 * Install the script → verify it on every page in the experiment. Not the Projects screen's
 * `PixelSetupDialog`: that one verifies a single site URL the user types, while this one checks
 * the experiment's own pages and feeds the result back into the launch checklist.
 */
export function InstallModal({
  open,
  s,
  d,
  onClose,
  onStep,
  onCopy,
  onVerify,
}: {
  open: boolean;
  s: SplitState;
  d: Derived;
  onClose(): void;
  onStep(n: 1 | 2): void;
  onCopy(): void;
  onVerify(): void;
}) {
  const vstate = s.verify;
  const istep = s.instStep;
  const tr = s.tracking;
  const checking = vstate === "checking";
  const lastOk = tr.status === "done" && !d.stale;
  const nP = d.pages.length;
  const plural = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
  const lastMissing = vstate === "idle" && d.missing.length > 0;
  const allFound = vstate === "success" || (vstate === "idle" && lastOk && d.missing.length === 0);

  const rTitle = checking
    ? "Checking " + plural(nP, "page") + "…"
    : allFound
      ? "Script found on " + (nP === 2 ? "both pages" : "all " + nP + " pages")
      : lastMissing
        ? "We couldn’t find the script on " + plural(d.missing.length, "page")
        : "Verification status";
  const tone = checking ? "check" : allFound ? "ok" : lastMissing ? "bad" : "idle";
  const rInk = tone === "ok" ? "#166534" : tone === "bad" ? "#B91C1C" : "#111827";
  const rBg = tone === "ok" ? "#ECFDF5" : tone === "bad" ? "#FEF2F2" : "#FAFBFC";
  const rBorder = tone === "ok" ? "#BBF7D0" : tone === "bad" ? "#FECACA" : "#E5E7EB";
  const vs = {
    check: { label: "Checking", bg: ACCENT_TINT, fg: ACCENT_INK, dot: ACCENT },
    ok: { label: "Verified", bg: "#DCFCE7", fg: "#166534", dot: "#16A34A" },
    bad: { label: "Not found", bg: "#FEE2E2", fg: "#B91C1C", dot: "#DC2626" },
    idle: { label: "Not checked yet", bg: "#F3F4F6", fg: "#4B5563", dot: "#9CA3AF" },
  }[tone];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={680}
      labelledBy="rt-inst-title"
      className="h-[720px] max-h-[calc(100vh-32px)] overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#EEF0F3] py-3 pr-3.5 pl-5 max-[641px]:py-2.5 max-[641px]:pr-2.5 max-[641px]:pl-3">
        <ol
          aria-label="Setup steps"
          className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0"
        >
          {(
            [
              [1, "Install pixel"],
              [2, "Verify"],
            ] as const
          ).map(([n, label]) => {
            const cur = n === istep;
            const done = n < istep || vstate === "success";
            return (
              <li key={n} className="flex flex-none items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onStep(n)}
                  aria-current={cur ? "step" : "false"}
                  disabled={checking}
                  className="flex h-[34px] cursor-pointer items-center gap-2 rounded-full border-0 pr-3 pl-1.5 text-[13px] whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] disabled:cursor-default disabled:opacity-45"
                  style={{
                    background: cur ? "#F3F4F6" : "transparent",
                    color: done ? "#166534" : cur ? "#111827" : "#4B5563",
                    fontWeight: cur ? 600 : 500,
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-flex size-[22px] flex-none items-center justify-center rounded-full border-[1.5px] border-solid text-[12px] font-semibold"
                    style={{
                      borderColor: done ? "#16A34A" : cur ? ACCENT : "#D1D5DB",
                      background: done ? "#16A34A" : cur ? ACCENT_TINT : "#FFFFFF",
                      color: done ? "#FFFFFF" : cur ? ACCENT_INK : "#6B7280",
                    }}
                  >
                    {done ? <CheckIcon size={11} strokeWidth={3.2} /> : n}
                  </span>
                  {label}
                </button>
                {n < 2 ? (
                  <span
                    aria-hidden
                    className="block h-0.5 w-6 rounded-[2px]"
                    style={{ background: istep > 1 ? ACCENT_LINE : "#E5E7EB" }}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[#6B7280] outline-none hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
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
                  className="inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-semibold"
                  style={{ background: ACCENT_TINT, color: ACCENT_INK }}
                >
                  <CodeIcon size={12} strokeWidth={2.4} />
                  Manual installation
                </span>
              </span>
              <DialogPrimitive.Title
                id="rt-inst-title"
                className="m-0 text-[18px] leading-[26px] font-semibold tracking-[-0.01em] text-[#111827]"
              >
                Add the Routely script to your site
              </DialogPrimitive.Title>
              <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
                It goes on every page in this experiment — the Control page, each variant and the
                conversion page — so Routely can redirect visitors and count conversions.
              </p>
              <HelpLink anchor="tracking-install" newTab>
                Installation guide
              </HelpLink>
            </div>
            <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
              <li className="relative flex min-w-0 items-start gap-3">
                <StepRail />
                <StepNum n={1} />
                <div className="flex min-w-0 flex-auto flex-col gap-2.5 pt-0.5">
                  <span className="text-[14px] leading-[22px] font-semibold text-[#111827]">
                    Copy the script and paste it into the header
                  </span>
                  <div className="flex flex-col overflow-hidden rounded-[12px] border border-[#EEF0F3] bg-[#F3F4F6]">
                    <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] py-1.5 pr-2 pl-3.5">
                      <span className="text-[12px] text-[#6B7280]">
                        Routely tracking script · {s.ctx.pixelKey}
                      </span>
                      <button
                        type="button"
                        onClick={onCopy}
                        className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#E5E7EB] bg-white px-2.5 text-[12px] font-medium text-[#374151] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
                      >
                        <CopyIcon />
                        {s.copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <pre
                      className={cn(
                        MONO,
                        "m-0 overflow-x-auto px-3.5 pt-3 pb-3.5 text-[13px] leading-[19px] break-normal [overflow-wrap:anywhere] whitespace-pre-wrap text-[#111827]",
                      )}
                    >
                      {s.ctx.snippet}
                    </pre>
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <StepNum n={2} />
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
              <DialogPrimitive.Title
                id="rt-inst-title"
                className="m-0 text-[18px] leading-[26px] font-semibold tracking-[-0.01em] text-[#111827]"
              >
                Verify your installation
              </DialogPrimitive.Title>
              <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
                Routely will load each page in this experiment and confirm the script is installed
                and sending data.
              </p>
            </div>
            <section
              aria-labelledby="rt-inst-vs"
              role="status"
              className="flex flex-col overflow-hidden rounded-[12px] border bg-white"
              style={{ borderColor: rBorder }}
            >
              <div
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-3"
                style={{ background: rBg, borderColor: rBorder }}
              >
                <h3
                  id="rt-inst-vs"
                  className="m-0 text-[14px] leading-5 font-semibold [overflow-wrap:anywhere]"
                  style={{ color: rInk }}
                >
                  {rTitle}
                </h3>
                <span
                  className="inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-semibold whitespace-nowrap"
                  style={{ background: vs.bg, color: vs.fg }}
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ background: vs.dot }}
                  />
                  {vs.label}
                </span>
              </div>
              <ul className="m-0 flex list-none flex-col px-4 py-1">
                {d.pages.map((pg, i) => {
                  const r = tr.results ? tr.results[pg.id] : null;
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
                            ? " · " + (tr.details?.[pg.id] ?? "Not found in the last check")
                            : " · Found in the last check")
                        : pg.url + " · Not checked yet";
                  return (
                    <li
                      key={pg.id}
                      className="flex items-center gap-3 py-2.5"
                      style={{ borderTop: "1px solid " + (i === 0 ? "transparent" : "#EEF0F3") }}
                    >
                      <span
                        aria-hidden
                        className="inline-flex size-[22px] flex-none items-center justify-center rounded-full"
                        style={{ background: look.iconBg, color: look.fg }}
                      >
                        {look.kind === "ok" ? <CheckIcon size={12} strokeWidth={3} /> : null}
                        {look.kind === "fail" ? <XIcon size={12} strokeWidth={3} /> : null}
                        {look.kind === "running" ? <Spinner size={12} strokeWidth={3} /> : null}
                        {look.kind === "pending" ? (
                          <span className="block size-1.5 rounded-full bg-current" />
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="text-[14px] leading-[19px] font-semibold text-[#111827]">
                          {pg.label}
                        </span>
                        <span className="text-[13px] leading-[19px] [overflow-wrap:anywhere] text-[#6B7280]">
                          {text}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {lastMissing ? (
                <div className="flex flex-col gap-1.5 border-t border-[#FECACA] bg-[#FEF2F2] px-4 pt-3 pb-3.5">
                  <span className="text-[13px] font-semibold text-[#111827]">Things to check</span>
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-[18px] text-[13px] leading-[19px] text-[#374151]">
                    {TIPS.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  <HelpLink anchor="tracking-not-found" newTab>
                    More fixes for a missing pixel
                  </HelpLink>
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0F3] bg-white px-6 py-3.5 max-[641px]:px-4 max-[641px]:py-3 max-[641px]:[&>button]:flex-auto max-[641px]:[&>button]:justify-center max-[641px]:[&>div]:flex-auto max-[641px]:[&>div]:justify-center">
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
              onClick={() => onStep(1)}
              disabled={checking}
              className={cn(cls.quiet, "h-9 gap-1.5 px-1 text-[#374151]")}
            >
              <ArrowLeftIcon />
              Back
            </button>
            <Actions>
              {vstate !== "success" ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={checking}
                    className={cn(cls.secondary, cls.tall, "px-4")}
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
            </Actions>
          </>
        )}
      </div>
    </Dialog>
  );
}

function StepRail() {
  return (
    <span
      aria-hidden
      className="absolute top-[30px] -bottom-3.5 left-3 w-0.5 rounded-[2px] bg-[#F3F4F6]"
    />
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative z-[1] inline-flex size-[26px] flex-none items-center justify-center rounded-full border-[1.5px] border-solid border-[#D1D5DB] bg-white text-[13px] font-semibold text-[#374151]",
      )}
    >
      {n}
    </span>
  );
}

// --- Launch confirmation ----------------------------------------------------------------------

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
    <Dialog
      open={open}
      onClose={onClose}
      busy={launching}
      width={480}
      labelledBy="rt-launch-title"
      describedBy="rt-launch-body"
      className="gap-[18px] p-6"
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden
          className="inline-flex size-10 flex-none items-center justify-center rounded-full"
          style={{ background: ACCENT_TINT, color: ACCENT_INK }}
        >
          <RocketIcon size={20} />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <DialogPrimitive.Title
            id="rt-launch-title"
            className="m-0 text-[16px] leading-6 font-semibold [overflow-wrap:anywhere] text-[#111827]"
          >
            {title}
          </DialogPrimitive.Title>
          <p id="rt-launch-body" className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">
            {body}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-[12px] border border-[#EEF0F3] bg-[#FAFBFC] p-3.5">
        {d.rvArms.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 text-[14px]">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Swatch color={a.color} />
              <span className="truncate font-medium text-[#374151]">{a.name}</span>
            </span>
            <span className="font-semibold text-[#111827] tabular-nums">{a.pct}</span>
          </div>
        ))}
        <div className="h-px bg-[#F3F4F6]" />
        <Detail label="Visitors included" value={d.includeShort} />
        <Detail label="Targeting" value={d.targetText} />
        <Detail label="Goal" value="Page visit" />
      </div>
      <Actions>
        <button
          type="button"
          onClick={onClose}
          disabled={launching}
          className={cn(cls.secondary, "px-4")}
        >
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={launching} className={cls.primary}>
          {launching ? <Spinner /> : null}
          {launching ? "Launching…" : "Launch experiment"}
        </button>
      </Actions>
    </Dialog>
  );
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-[#6B7280]">{label}</span>
      <span className="text-right font-medium text-[#374151]">{value}</span>
    </div>
  );
}

// --- Pause / resume ---------------------------------------------------------------------------

export function PauseDialog({
  open,
  paused,
  name,
  onClose,
  onConfirm,
}: {
  open: boolean;
  paused: boolean;
  name: string;
  onClose(): void;
  onConfirm(): void;
}) {
  const n = name || "This experiment";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={440}
      labelledBy="rt-pause-title"
      describedBy="rt-pause-body"
      className="gap-5 p-6"
    >
      <div className="flex flex-col gap-1.5">
        <DialogPrimitive.Title
          id="rt-pause-title"
          className="m-0 text-[16px] leading-6 font-semibold text-[#111827]"
        >
          {paused ? "Resume this experiment?" : "Pause this experiment?"}
        </DialogPrimitive.Title>
        <p id="rt-pause-body" className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">
          {paused
            ? "“" + n + "” will start splitting visitors again using its current traffic settings."
            : "“" +
              n +
              "” will stop redirecting visitors, and everyone will see the Control page. Data collected so far is kept."}
        </p>
      </div>
      <Actions>
        <button type="button" onClick={onClose} className={cn(cls.secondary, "px-4")}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={cn(cls.primary, "font-medium")}
          style={{ background: ACCENT }}
        >
          {paused ? "Resume experiment" : "Pause experiment"}
        </button>
      </Actions>
    </Dialog>
  );
}
