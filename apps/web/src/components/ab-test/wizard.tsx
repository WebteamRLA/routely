"use client";

import type { ReactNode } from "react";

import { HelpLink } from "@/components/common/help-link";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  Spinner,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@/components/rt/icons";
import {
  ACCENT,
  ACCENT_INK,
  ACCENT_LINE,
  ACCENT_WASH,
  MAX_VARIANTS,
  type AbForm,
  type AbState,
} from "@/lib/mock/ab-test";
import { cn } from "@/lib/utils";

import {
  BarsIcon,
  CodeIcon,
  DesktopIcon,
  EyeIcon,
  HistoryIcon,
  LockIcon,
  MobileIcon,
  RefreshIcon,
  RocketIcon,
  SmallAlertIcon,
  TabletIcon,
} from "./icons";
import type { Derived } from "./model";
import { cls, FieldError, Swatch } from "./ui";

export interface WizardAct {
  setForm(patch: Partial<AbForm>): void;
  goStep(n: number): void;
  next(): void;
  back(): void;
  fix(n: number): void;
  openEditor(target: string): void;
  addVariant(): void;
  /** `pendingChanges`: the visual editor's count for the variant it has open (unsaved included). */
  removeVariant(id: string, pendingChanges?: number): void;
  applySplit(id: string, raw: string): void;
  splitEvenly(): void;
  setInclude(raw: string): void;
  toggleDevice(k: "desktop" | "mobile" | "tablet"): void;
  recheck(): void;
  openInstall(): void;
  saveDraft(): void;
  launchClick(): void;
  dismissResume(): void;
}

type P = { s: AbState; d: Derived; act: WizardAct };

/** Steps 1–5 with the stepper, banners and the sticky summary beside them. */
export function Wizard({ s, d, act }: P) {
  const step = s.step;
  return (
    <>
      <Stepper s={s} d={d} act={act} />

      {s.resumed && s.resumeInfo ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border py-3 pr-3 pl-3.5"
          style={{ borderColor: ACCENT_LINE, background: ACCENT_WASH }}
        >
          <HistoryIcon className="mt-px flex-none" style={{ color: ACCENT }} />
          <div className="flex min-w-0 flex-auto flex-col gap-0.5">
            <span className="text-[14px] leading-5 font-semibold text-[#111827]">
              {s.resumeInfo.title}
            </span>
            <span className="text-[14px] leading-5 text-pretty text-[#374151]">
              {s.resumeInfo.text}
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={act.dismissResume}
            className={cn(cls.ghost, "-my-1 size-7 flex-none rounded-md text-[#4B5563]")}
          >
            <XIcon size={14} strokeWidth={2.2} />
          </button>
        </div>
      ) : null}

      {s.launchError ? (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
        >
          <AlertCircleIcon size={20} strokeWidth={1.8} className="mt-px flex-none text-[#B91C1C]" />
          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-[#B91C1C]">
              We couldn’t launch your experiment
            </span>
            <span className="text-[14px] leading-5 text-[#B91C1C]">
              Something went wrong on our side. Your settings and variant changes are saved as a
              draft, so you can try again without losing anything.
            </span>
          </div>
          <button
            type="button"
            onClick={act.launchClick}
            className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#FECACA] bg-white px-3.5 text-[13px] font-medium whitespace-nowrap text-[#B91C1C] hover:bg-[#F9FAFB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
          >
            Try again
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          "grid items-start gap-6 max-[961px]:grid-cols-[minmax(0,1fr)]",
          step < 5 ? "grid-cols-[minmax(0,65fr)_minmax(0,35fr)]" : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        <section
          aria-labelledby="rt-step-title"
          className="min-w-0 rounded-xl border border-[#EEF0F3] bg-white"
        >
          <div className="flex flex-col gap-1 px-6 pt-6 max-[641px]:px-4">
            <h2
              id="rt-step-title"
              className="m-0 text-[16px] leading-6 font-semibold tracking-[-0.01em] text-[#111827]"
            >
              {d.cur.title}
            </h2>
            <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
              {d.cur.desc}
            </p>
            <HelpLink
              anchor={s.step === 5 ? "launch" : s.step === 1 ? "visual-editor" : "ab-create"}
              newTab
              className="mt-1 self-start"
            >
              {s.step === 5
                ? "What launching checks"
                : s.step === 1
                  ? "How the visual editor works"
                  : "A/B test guide"}
            </HelpLink>
          </div>

          {d.errBanner ? (
            <div className="px-6 pt-4 max-[641px]:px-4">
              <div
                role="alert"
                className="flex items-center gap-2.5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[14px] font-medium text-[#B91C1C]"
              >
                <AlertCircleIcon size={16} className="flex-none" />
                Fix {d.errBanner} {d.errBanner === 1 ? "issue" : "issues"} to continue.
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-6 p-6 max-[641px]:px-4">
            {step === 1 ? <Step1 s={s} d={d} act={act} /> : null}
            {step === 2 ? <Step2 d={d} act={act} /> : null}
            {step === 3 ? <Step3 s={s} d={d} act={act} /> : null}
            {step === 4 ? <Step4 s={s} d={d} act={act} /> : null}
            {step === 5 ? <Step5 d={d} act={act} /> : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0F3] px-6 py-4 max-[641px]:p-4">
            <div className="flex">
              {step > 1 ? (
                <button type="button" onClick={act.back} className={cn(cls.secondary, cls.tall)}>
                  <ArrowLeftIcon />
                  Back
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-2 max-[641px]:w-full max-[641px]:[&>button]:h-11 max-[641px]:[&>button]:flex-auto">
              {step === 5 ? (
                <>
                  <span
                    className="text-[13px] max-[641px]:flex-[1_1_100%] max-[641px]:text-left"
                    style={{ color: d.foot.hintFg }}
                  >
                    {d.foot.hint}
                  </span>
                  <button type="button" onClick={act.saveDraft} className={cls.secondary}>
                    Save as draft
                  </button>
                  <button
                    type="button"
                    onClick={act.launchClick}
                    disabled={d.foot.launchDisabled}
                    className={cls.primary}
                  >
                    <RocketIcon />
                    Launch experiment
                  </button>
                </>
              ) : (
                <button type="button" onClick={act.next} className={cls.primary}>
                  {d.foot.nextLabel}
                  <ArrowRightIcon />
                </button>
              )}
            </div>
          </div>
        </section>

        {step < 5 ? <Summary s={s} d={d} act={act} /> : null}
      </div>
    </>
  );
}

function Stepper({ s, d, act }: P) {
  return (
    <>
      <nav
        aria-label="Experiment setup steps"
        className="rounded-xl border border-[#E5E7EB] bg-white p-2.5 max-[901px]:hidden"
      >
        <ol className="m-0 flex list-none items-center gap-1 p-0">
          {d.steps.map((st) => (
            <li key={st.n} className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (!st.locked) act.goStep(st.n);
                }}
                disabled={st.locked}
                aria-current={st.current ? "step" : "false"}
                aria-label={st.aria}
                className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] hover:enabled:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] disabled:cursor-default disabled:opacity-45"
              >
                <span
                  aria-hidden
                  className="inline-flex size-7 flex-none items-center justify-center rounded-full border-[1.5px] text-[13px] font-semibold"
                  style={{ borderColor: st.ring, background: st.bg, color: st.fg }}
                >
                  {st.done ? <CheckIcon size={14} strokeWidth={2.8} /> : st.isError ? "!" : st.n}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[12px] leading-[15px] text-[#6B7280]">Step {st.n}</span>
                  <span
                    className="truncate text-[14px] leading-[18px] font-semibold"
                    style={{ color: st.labelFg }}
                  >
                    {st.label}
                  </span>
                </span>
              </button>
              {st.n < 5 ? (
                <span
                  aria-hidden
                  className="block h-0.5 min-w-2 flex-auto rounded-sm"
                  style={{ background: st.line }}
                />
              ) : null}
            </li>
          ))}
        </ol>
      </nav>

      <div className="hidden flex-col gap-2.5 rounded-xl border border-[#EEF0F3] bg-white px-4 py-3.5 max-[901px]:flex">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] font-semibold text-[#111827]">{d.cur.label}</span>
          <span className="text-[13px] whitespace-nowrap text-[#6B7280]">Step {s.step} of 5</span>
        </div>
        <div aria-hidden className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5].map((k) => (
            <span
              key={k}
              className="block h-1 rounded-full"
              style={{ background: k <= s.step ? ACCENT : "#E5E7EB" }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function Field({ children, gap = 6 }: { children: ReactNode; gap?: number }) {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {children}
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="m-0 text-[14px] leading-5 font-semibold text-[#111827]">{title}</h3>
      <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">{sub}</p>
    </div>
  );
}

const versionRow =
  "grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3.5 py-3 max-[641px]:grid-cols-[minmax(0,1fr)_auto] max-[641px]:[grid-template-areas:'label_act'_'status_status']";

function Step1({ s, d, act }: P) {
  const f = s.form;
  const editorDisabled = !d.pageValid;
  return (
    <>
      <Field>
        <label htmlFor="rt-name" className="text-[13px] font-medium text-[#374151]">
          Experiment name
        </label>
        <input
          id="rt-name"
          type="text"
          value={f.name}
          onChange={(e) => act.setForm({ name: e.target.value })}
          placeholder="e.g. Fall homepage hero"
          aria-invalid={d.e1.name ? "true" : "false"}
          maxLength={80}
          className={cn(cls.input, "h-10 px-3")}
        />
        {d.e1.name ? <FieldError>{d.e1.name}</FieldError> : null}
      </Field>

      <Field>
        <label htmlFor="rt-pu" className="text-[13px] font-medium text-[#374151]">
          Page URL
        </label>
        <input
          id="rt-pu"
          type="url"
          value={f.pageUrl}
          onChange={(e) => act.setForm({ pageUrl: e.target.value })}
          placeholder={"https://" + s.ctx.domain + "/"}
          aria-invalid={d.e1.page ? "true" : "false"}
          className={cn(cls.input, "h-10 px-3")}
        />
        {d.e1.page ? (
          <FieldError>{d.e1.page}</FieldError>
        ) : (
          <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">
            The page you want to test. Variants change elements on this page — visitors stay on the
            same URL.
          </p>
        )}
      </Field>

      <Field gap={10}>
        <SectionHead
          title="Versions"
          sub="The Control stays exactly as it is. Each variant needs at least one saved change."
        />
        <div className="rounded-xl border border-[#EEF0F3]">
          <div className={versionRow}>
            <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-[#111827] max-[641px]:[grid-area:label]">
              <Swatch color="#6B7280" radius={999} />
              Control
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-[#6B7280] max-[641px]:[grid-area:status]">
              <LockIcon className="flex-none" />
              Original page · never changed
            </span>
            <div className="flex justify-end max-[641px]:[grid-area:act]">
              <button
                type="button"
                onClick={() => act.openEditor("control")}
                disabled={editorDisabled}
                className={cn(cls.secondary, "h-[34px] gap-1.5 px-3", cls.tall)}
              >
                <EyeIcon />
                View original
              </button>
            </div>
          </div>
          {d.variants.map((v) => (
            <div key={v.id} className={cn(versionRow, "border-t border-[#EEF0F3]")}>
              <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-[#111827] max-[641px]:[grid-area:label]">
                <Swatch color={v.color} radius={999} />
                <span className="truncate">{v.name}</span>
              </span>
              <span
                className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium max-[641px]:[grid-area:status]"
                style={{ color: v.statusFg }}
              >
                {v.n ? (
                  <CheckIcon size={14} strokeWidth={2.4} className="flex-none" />
                ) : (
                  <SmallAlertIcon className="flex-none" />
                )}
                <span className="truncate">{v.statusText}</span>
              </span>
              <div className="flex items-center justify-end gap-1 max-[641px]:[grid-area:act]">
                <button
                  type="button"
                  onClick={() => act.openEditor(v.id)}
                  disabled={editorDisabled}
                  className={cn(cls.tint, "gap-1.5", cls.tall)}
                >
                  <PencilIcon size={15} />
                  {v.openLabel}
                </button>
                {f.variants.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => act.removeVariant(v.id)}
                    aria-label={"Remove " + v.name}
                    className={cn(cls.ghost, "size-[34px] text-[#4B5563]")}
                  >
                    <TrashIcon />
                  </button>
                ) : null}
              </div>
              {v.err ? (
                <div className="col-[2/-1] max-[641px]:col-[1/-1]">
                  <FieldError>{v.err}</FieldError>
                </div>
              ) : null}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[#EEF0F3] px-3.5 py-2">
            <button
              type="button"
              onClick={act.addVariant}
              disabled={f.variants.length >= MAX_VARIANTS}
              className={cn(cls.link, "-ml-1.5 h-[34px] gap-1.5 px-1.5", cls.tall)}
            >
              <PlusIcon size={16} />
              Add variant
            </button>
            <span className="text-[13px] text-[#6B7280]">
              {f.variants.length >= MAX_VARIANTS
                ? MAX_VARIANTS + " of " + MAX_VARIANTS + " variants added"
                : "Up to " + MAX_VARIANTS + " variants"}
            </span>
          </div>
        </div>
        {editorDisabled ? (
          <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">
            Enter a valid page URL to view the original page and open the visual editor.
          </p>
        ) : null}
      </Field>
    </>
  );
}

function Step2({ d, act }: { d: Derived; act: WizardAct }) {
  return (
    <>
      <div className="flex flex-col gap-4">
        <SectionHead
          title="Split between versions"
          sub="How visitors in the experiment are divided between the Control and your variants."
        />
        <div
          role="img"
          aria-label={d.splitAria}
          className="flex h-[52px] gap-0.5 overflow-hidden rounded-lg bg-[#F3F4F6]"
        >
          {d.splitSegs.map((b) => (
            <span
              key={b.id}
              className="flex h-full min-w-0 flex-none items-center justify-center truncate px-2 text-[13px] font-semibold whitespace-nowrap transition-[width] duration-200 ease-[ease]"
              style={{ width: b.width, background: b.color, color: b.fg }}
            >
              {b.label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span
            aria-live="polite"
            className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap tabular-nums"
            style={{
              background: d.e2.totalOk ? "#DCFCE7" : "#FEF2F2",
              color: d.e2.totalOk ? "#166534" : "#B91C1C",
            }}
          >
            {d.e2.totalOk ? (
              <CheckIcon size={14} strokeWidth={2.6} />
            ) : (
              <AlertCircleIcon size={14} strokeWidth={2.2} />
            )}
            Total {d.e2.total}%
          </span>
          <button
            type="button"
            onClick={act.splitEvenly}
            className={cn(cls.secondary, "px-3", cls.tall)}
          >
            <BarsIcon />
            Split evenly
          </button>
        </div>
        <div className="flex flex-col border-t border-[#EEF0F3]">
          {d.splitRows.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[minmax(120px,1fr)_minmax(0,2fr)_auto] items-center gap-x-6 gap-y-2.5 border-b border-[#EEF0F3] py-4 max-[641px]:grid-cols-[minmax(0,1fr)_auto] max-[641px]:[grid-template-areas:'name_num'_'slide_slide']"
            >
              <div className="flex min-w-0 items-start gap-2.5 max-[641px]:[grid-area:name]">
                <Swatch color={r.color} size={10} radius={3} className="mt-[5px]" />
                <span className="flex min-w-0 flex-col">
                  <label
                    htmlFor={"rt-sp-" + r.id}
                    className="truncate text-[13px] leading-5 font-medium text-[#374151]"
                  >
                    {r.name}
                  </label>
                  <span className="truncate text-[13px] leading-[18px] text-[#6B7280]">
                    {r.sub}
                  </span>
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1 max-[641px]:[grid-area:slide]">
                <input
                  type="range"
                  min={1}
                  max={r.max}
                  step={1}
                  value={r.num}
                  onChange={(e) => act.applySplit(r.id, e.target.value)}
                  aria-label={r.name + " traffic share"}
                  aria-valuetext={r.value + "%"}
                  className="m-0 w-full"
                  style={{ accentColor: ACCENT }}
                />
                <span className="text-[13px] leading-[18px] text-[#6B7280]">{r.est}</span>
              </div>
              <div className="flex items-center gap-2 max-[641px]:[grid-area:num]">
                <input
                  id={"rt-sp-" + r.id}
                  type="text"
                  inputMode="numeric"
                  value={r.value}
                  onChange={(e) => act.applySplit(r.id, e.target.value)}
                  aria-invalid={r.invalid ? "true" : "false"}
                  className={cn(cls.input, "h-10 w-16 px-2 text-center font-semibold tabular-nums")}
                />
                <span aria-hidden className="text-[14px] font-semibold text-[#6B7280]">
                  %
                </span>
              </div>
            </div>
          ))}
        </div>
        {d.e2.split ? <FieldError alert>{d.e2.split}</FieldError> : null}
        <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">
          Moving one slider rebalances the others, so the total always stays at 100%.
        </p>
      </div>
      <div className="h-px bg-[#F3F4F6]" />
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="rt-inc" className="text-[13px] leading-5 font-medium text-[#374151]">
            Traffic included in experiment
          </label>
          <span
            aria-hidden
            className="text-[24px] leading-[30px] font-semibold tracking-[-0.02em] text-[#111827] tabular-nums"
          >
            {d.incDisplay}
          </span>
        </div>
        <input
          id="rt-inc"
          type="range"
          min={1}
          max={100}
          step={1}
          value={d.incRange}
          onChange={(e) => act.setInclude(e.target.value)}
          aria-valuetext={d.incDisplay + " of visitors included"}
          className="m-0 w-full"
          style={{ accentColor: ACCENT }}
        />
        <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">{d.incCaption}</p>
        {d.e2.include ? <FieldError>{d.e2.include}</FieldError> : null}
      </div>
    </>
  );
}

function OptionCard({
  on,
  className,
  children,
}: {
  on: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(cls.option, className)}
      style={{ borderColor: on ? ACCENT : "#E5E7EB", background: on ? ACCENT_WASH : "#FFFFFF" }}
    >
      {children}
    </label>
  );
}

function Step3({ s, d, act }: P) {
  const f = s.form;
  const devices = [
    ["desktop", "Desktop", DesktopIcon],
    ["mobile", "Mobile", MobileIcon],
    ["tablet", "Tablet", TabletIcon],
  ] as const;
  return (
    <>
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-3 p-0 text-[14px] leading-5 font-semibold text-[#111827]">
          Who can enter the experiment
        </legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
          <OptionCard on={f.targeting === "all"} className="flex items-start gap-3 p-4">
            <input
              type="radio"
              name="rt-target"
              checked={f.targeting === "all"}
              onChange={() => act.setForm({ targeting: "all" })}
              className="mt-px mb-0 size-[18px] flex-none"
              style={{ accentColor: ACCENT }}
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-[#111827]">All visitors</span>
                <span className="inline-flex h-6 items-center rounded-md bg-[#F3F4F6] px-2 text-[12px] font-semibold text-[#4B5563]">
                  Default
                </span>
              </span>
              <span className="text-[13px] leading-[19px] text-[#6B7280]">
                Anyone who visits the page can enter, on any device.
              </span>
            </span>
          </OptionCard>
          <OptionCard on={f.targeting === "specific"} className="flex items-start gap-3 p-4">
            <input
              type="radio"
              name="rt-target"
              checked={f.targeting === "specific"}
              onChange={() => act.setForm({ targeting: "specific" })}
              className="mt-px mb-0 size-[18px] flex-none"
              style={{ accentColor: ACCENT }}
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-[14px] font-semibold text-[#111827]">Specific devices</span>
              <span className="text-[13px] leading-[19px] text-[#6B7280]">
                Only include visitors on the device types you choose.
              </span>
            </span>
          </OptionCard>
        </div>
      </fieldset>
      {f.targeting === "specific" ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className="mb-3 p-0 text-[14px] leading-5 font-semibold text-[#111827]">
            Devices
          </legend>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-3">
            {devices.map(([k, label, Icon]) => (
              <OptionCard
                key={k}
                on={f.devices[k]}
                className="flex min-h-16 items-center gap-3 px-3.5 py-3"
              >
                <input
                  type="checkbox"
                  checked={f.devices[k]}
                  onChange={() => act.toggleDevice(k)}
                  className="m-0 size-[18px] flex-none"
                  style={{ accentColor: ACCENT }}
                />
                <Icon className="text-[#4B5563]" />
                <span className="text-[14px] font-semibold text-[#111827]">{label}</span>
              </OptionCard>
            ))}
          </div>
          {d.e3.devices ? <FieldError alert>{d.e3.devices}</FieldError> : null}
          <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">{d.targetHint}</p>
        </fieldset>
      ) : null}
    </>
  );
}

function Step4({ s, d, act }: P) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-[14px] leading-5 font-semibold text-[#111827]">Goal type</h3>
        <div
          className="flex items-start gap-3 rounded-xl border-[1.5px] p-4"
          style={{ borderColor: ACCENT_LINE, background: ACCENT_WASH }}
        >
          <span
            aria-hidden
            className="inline-flex size-8 flex-none items-center justify-center rounded-lg border bg-white"
            style={{ color: ACCENT_INK, borderColor: ACCENT_LINE }}
          >
            <EyeIcon size={18} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-[#111827]">Page view</span>
              <span className="inline-flex h-6 items-center rounded-md border border-[#E5E7EB] bg-white px-2 text-[12px] font-semibold text-[#4B5563]">
                Only goal type
              </span>
            </span>
            <span className="text-[13px] leading-[19px] text-[#6B7280]">
              A conversion counts when a visitor from any version views the goal page.
            </span>
          </span>
        </div>
      </div>
      <Field>
        <label htmlFor="rt-gu" className="text-[13px] font-medium text-[#374151]">
          Goal page URL
        </label>
        <input
          id="rt-gu"
          type="url"
          value={s.form.goalUrl}
          onChange={(e) => act.setForm({ goalUrl: e.target.value })}
          placeholder={"https://" + s.ctx.domain + "/collections/fall-sale"}
          aria-invalid={d.e4.url ? "true" : "false"}
          className={cn(cls.input, "h-10 px-3")}
        />
        {d.e4.url ? <FieldError>{d.e4.url}</FieldError> : null}
        <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">
          Views of this exact URL count as conversions.
        </p>
      </Field>
      <div className="flex items-start gap-2.5 rounded-lg bg-[#F9FAFB] px-3.5 py-3">
        <InfoIcon size={16} strokeWidth={1.8} className="mt-0.5 flex-none text-[#4B5563]" />
        <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#374151]">
          Use a page visitors reach <strong>after</strong> the page you’re testing, like the
          collection page your hero button links to. If the goal were the tested page itself, every
          visitor would count as converted.
        </p>
      </div>
    </>
  );
}

function ReviewHead({ title, onEdit }: { title: string; onEdit(): void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="m-0 text-[14px] font-semibold text-[#111827]">{title}</h3>
      <button type="button" onClick={onEdit} className={cn(cls.link, "h-8 px-1.5")}>
        Edit
      </button>
    </div>
  );
}

function SplitBar({ d, height = 8 }: { d: Derived; height?: number }) {
  return (
    <div
      aria-hidden
      className="flex gap-0.5 overflow-hidden rounded-full bg-[#F3F4F6]"
      style={{ height }}
    >
      {d.splitBar.map((b) => (
        <span
          key={b.id}
          className="block h-full flex-none"
          style={{ width: b.width, background: b.color }}
        />
      ))}
    </div>
  );
}

function Step5({ d, act }: { d: Derived; act: WizardAct }) {
  const { rv, tr } = d;
  return (
    <>
      <div className="flex flex-col rounded-xl border border-[#EEF0F3]">
        <div className="flex flex-col gap-2.5 p-4">
          <ReviewHead title="Setup & variants" onEdit={() => act.goStep(1)} />
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-[#111827]">{rv.name}</span>
            <span className="text-[13px] [overflow-wrap:anywhere] text-[#4B5563]">{rv.page}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {rv.versions.map((vv) => (
              <div
                key={vv.id}
                className="flex flex-col gap-1 rounded-lg border border-[#EEF0F3] bg-[#FAFBFC] px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#374151]">
                    <Swatch color={vv.color} size={10} radius={3} />
                    {vv.name}
                  </span>
                  <span className="text-[13px] text-[#6B7280]">{vv.meta}</span>
                </div>
                {vv.changes.map((c, i) => (
                  <span
                    key={i}
                    className="pl-[18px] text-[13px] leading-[19px] [overflow-wrap:anywhere] text-[#374151]"
                  >
                    {c}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2.5 border-t border-[#EEF0F3] p-4">
          <ReviewHead title="Traffic" onEdit={() => act.goStep(2)} />
          <span className="text-[14px] text-[#374151]">{rv.include}</span>
          <SplitBar d={d} />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {rv.arms.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 text-[13px] text-[#374151]"
              >
                <Swatch color={a.color} />
                {a.name} <strong className="font-semibold text-[#111827]">{a.pct}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 border-t border-[#EEF0F3] p-4">
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
            <ReviewHead title="Targeting" onEdit={() => act.goStep(3)} />
            <span className="text-[14px] text-[#374151]">{rv.targeting}</span>
          </div>
          <div className="flex min-w-0 flex-[2_1_280px] flex-col gap-1.5">
            <ReviewHead title="Goal" onEdit={() => act.goStep(4)} />
            <span className="text-[14px] text-[#374151]">Page view</span>
            <span className="text-[13px] [overflow-wrap:anywhere] text-[#4B5563]">
              {rv.goalUrl}
            </span>
          </div>
        </div>
      </div>

      {rv.issues.length ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
        >
          <span className="text-[14px] font-semibold text-[#B91C1C]">
            Finish these steps before launching
          </span>
          {rv.issues.map((is) => (
            <div key={is.n} className="flex items-center justify-between gap-3">
              <span className="text-[14px] text-[#B91C1C]">{is.label}</span>
              <button
                type="button"
                onClick={() => act.fix(is.n)}
                className="h-8 cursor-pointer rounded-lg border border-[#FECACA] bg-white px-3 text-[13px] font-medium text-[#B91C1C] hover:bg-[#F9FAFB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
              >
                Fix
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3.5 rounded-xl border border-[#EEF0F3] p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2.5">
            <CodeIcon className="text-[#374151]" />
            <h3 className="m-0 text-[14px] font-semibold text-[#111827]">Tracking installation</h3>
            <HelpLink anchor="launch-blocked" newTab>
              Launch blocked?
            </HelpLink>
          </div>
          <span
            aria-live="polite"
            className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold whitespace-nowrap"
            style={{ background: tr.pillBg, color: tr.pillFg }}
          >
            {tr.pill}
          </span>
        </div>
        <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
          The Routely snippet must be on the page you’re testing, so variant changes can be applied,
          and on the goal page, so page views can be counted.
        </p>
        {!tr.isError ? (
          <div className="flex flex-col rounded-lg border border-[#EEF0F3]">
            {tr.rows.map((tw, i) => (
              <div
                key={tw.id}
                className="flex items-center gap-3 px-3 py-2.5"
                style={{ borderTop: "1px solid " + (i === 0 ? "transparent" : "#EEF0F3") }}
              >
                <span
                  aria-hidden
                  className="inline-flex size-[22px] flex-none items-center justify-center rounded-full"
                  style={{ background: tw.iconBg, color: tw.iconFg }}
                >
                  {tw.stt === "checking" ? <Spinner size={13} strokeWidth={2.6} /> : null}
                  {tw.stt === "ok" ? <CheckIcon size={13} strokeWidth={3} /> : null}
                  {tw.stt === "missing" ? (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 7v6" />
                      <path d="M12 17v.3" />
                    </svg>
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-auto flex-col">
                  <span className="text-[14px] font-semibold text-[#374151]">{tw.label}</span>
                  <span className="truncate text-[13px] text-[#6B7280]">{tw.url}</span>
                </span>
                <span
                  className="text-[13px] font-medium whitespace-nowrap"
                  style={{ color: tw.textFg }}
                >
                  {tw.text}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {tr.isError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-3"
          >
            <AlertCircleIcon
              size={18}
              strokeWidth={1.8}
              className="mt-px flex-none text-[#B91C1C]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-semibold text-[#B91C1C]">
                We couldn’t check your pages
              </span>
              <span className="text-[13px] leading-[19px] text-[#B91C1C]">
                Make sure each URL is public and loads in a browser, then try again.
              </span>
            </span>
          </div>
        ) : null}
        {tr.isMissing ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FEF3C7] px-3.5 py-3">
            <WarningIcon size={18} strokeWidth={1.8} className="mt-px flex-none text-[#92400E]" />
            <span className="text-[13px] leading-[19px] text-[#92400E]">{tr.missingText}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {tr.showInstall ? (
            <button
              type="button"
              onClick={act.openInstall}
              className={cn(cls.primary, "px-3.5", cls.tall)}
            >
              <CodeIcon size={15} strokeWidth={2} />
              Install tracking
            </button>
          ) : null}
          <button
            type="button"
            onClick={act.recheck}
            disabled={tr.isChecking}
            className={cn(cls.secondary, cls.tall)}
          >
            <RefreshIcon />
            {tr.recheckLabel}
          </button>
        </div>
      </div>
    </>
  );
}

function SumSection({
  label,
  edit,
  editLabel,
  onEdit,
  gap = 12,
  last = false,
  children,
}: {
  label: string;
  edit: boolean;
  editLabel: string;
  onEdit(): void;
  gap?: number;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex flex-col px-[22px]",
        last ? "pt-[18px] pb-5" : "border-b border-[#EEF0F3] py-[18px]",
      )}
      style={{ gap }}
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h3 className={cls.eyebrow}>{label === "Page and versions" ? "Page & versions" : label}</h3>
        {edit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={editLabel}
            className={cn(cls.link, "h-7 px-1")}
          >
            Edit
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Summary({ d, act }: P) {
  const { sum, rv } = d;
  return (
    <aside
      aria-label="Experiment summary"
      className="sticky top-6 flex min-w-0 flex-col self-start rounded-xl border border-[#EEF0F3] bg-white max-[1200px]:static"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#EEF0F3] px-[22px] pt-5 pb-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 text-[16px] leading-6 font-semibold text-[#111827]">Summary</h2>
          <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
            Updates as you fill in each step.
          </p>
        </div>
        <span
          className="inline-flex h-6 flex-none items-center rounded-md px-2 text-[12px] font-semibold whitespace-nowrap"
          style={{ background: sum.readyBg, color: sum.readyFg }}
        >
          {sum.ready}
        </span>
      </div>
      <SumSection
        label="Page and versions"
        edit={sum.showEdit(1)}
        editLabel="Edit page and versions"
        onEdit={() => act.goStep(1)}
      >
        <span
          className="text-[14px] leading-5 [overflow-wrap:anywhere]"
          style={{ color: sum.pageFg }}
        >
          {sum.page}
        </span>
        {sum.versions.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 text-[14px] leading-5">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Swatch color={a.color} />
              <span className="font-semibold text-[#374151]">{a.name}</span>
            </span>
            <span className="whitespace-nowrap" style={{ color: a.metaFg }}>
              {a.meta}
            </span>
          </div>
        ))}
      </SumSection>
      <SumSection
        label="Traffic"
        edit={sum.showEdit(2)}
        editLabel="Edit traffic"
        onEdit={() => act.goStep(2)}
      >
        <span className="text-[14px] leading-5 text-[#374151]">{sum.include}</span>
        <SplitBar d={d} />
        <div className="flex flex-col gap-2">
          {rv.arms.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 text-[14px] leading-5"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <Swatch color={a.color} />
                <span className="text-[#374151]">{a.name}</span>
              </span>
              <span className="font-semibold text-[#111827] tabular-nums">{a.pct}</span>
            </div>
          ))}
        </div>
      </SumSection>
      <SumSection
        label="Targeting"
        edit={sum.showEdit(3)}
        editLabel="Edit targeting"
        onEdit={() => act.goStep(3)}
        gap={6}
      >
        <span className="text-[14px] leading-5 font-medium text-[#374151]">{rv.targeting}</span>
      </SumSection>
      <SumSection
        label="Goal"
        edit={sum.showEdit(4)}
        editLabel="Edit goal"
        onEdit={() => act.goStep(4)}
        gap={6}
        last
      >
        <span className="text-[14px] leading-5 font-semibold text-[#374151]">Page view</span>
        <span
          className="text-[14px] leading-5 [overflow-wrap:anywhere]"
          style={{ color: sum.goalFg }}
        >
          {sum.goal}
        </span>
      </SumSection>
    </aside>
  );
}
