"use client";

import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  InfoIcon,
  PlusIcon,
  Spinner,
  TrashIcon,
  WarningIcon,
} from "@/components/rt/icons";
import {
  ACCENT,
  ACCENT_INK,
  ACCENT_LINE,
  ACCENT_TINT,
  ACCENT_WASH,
  LABEL_FG,
  MAX_VARIANTS,
  STEPS,
  colorOf,
  fmt,
  host,
  norm,
  shortUrl,
  validUrl,
  type SplitForm,
  type SplitState,
} from "@/lib/mock/split-url";
import { cn } from "@/lib/utils";

import type { Derived } from "./model";
import {
  BangIcon,
  BarsIcon,
  Chip,
  CodeIcon,
  DesktopIcon,
  ExternalIcon,
  FieldError,
  FieldWarning,
  MobileIcon,
  RefreshIcon,
  RocketIcon,
  Swatch,
  TabletIcon,
  VisitIcon,
  cls,
} from "./ui";

export interface WizardAct {
  setForm(patch: Partial<SplitForm> | ((f: SplitForm) => Partial<SplitForm>)): void;
  goStep(n: number): void;
  next(): void;
  back(): void;
  fix(n: number): void;
  addVariant(): void;
  removeVariant(id: string): void;
  applySplit(id: string, raw: string): void;
  splitEvenly(): void;
  setInclude(raw: string): void;
  toggleDevice(k: "desktop" | "mobile" | "tablet"): void;
  recheck(): void;
  openInstall(): void;
  saveDraft(): void;
  openLaunch(): void;
}

interface Props {
  s: SplitState;
  d: Derived;
  act: WizardAct;
}

const border = (has: unknown) => (has ? "#DC2626" : "#E5E7EB");
const inv = (has: unknown) => (has ? "true" : "false");

/** The five-step setup flow: stepper, the current step's card and the live summary beside it. */
export function Wizard({ s, d, act }: Props) {
  const step = s.step;
  const att = s.attempted;
  const cur = STEPS[step - 1] ?? STEPS[0];
  const e = step < 5 ? d.errs[step as 1 | 2 | 3 | 4] : { count: 0 };
  const showBanner = step < 5 && !!att[step] && e.count > 0;

  return (
    <>
      <Stepper s={s} d={d} act={act} />

      <div className="hidden flex-col gap-2.5 rounded-[12px] border border-[#EEF0F3] bg-white px-4 py-3.5 max-[901px]:flex">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] font-semibold text-[#111827]">{cur.label}</span>
          <span className="text-[13px] whitespace-nowrap text-[#6B7280]">Step {step} of 5</span>
        </div>
        <div aria-hidden className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5].map((k) => (
            <span
              key={k}
              className="block h-1 rounded-full"
              style={{ background: k <= step ? ACCENT : "#E5E7EB" }}
            />
          ))}
        </div>
      </div>

      {s.launchError ? (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
        >
          <AlertCircleIcon size={20} strokeWidth={1.8} className="mt-px flex-none text-[#B91C1C]" />
          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-[#B91C1C]">
              We couldn’t launch your experiment
            </span>
            <span className="text-[14px] leading-5 text-[#B91C1C]">
              Something went wrong on our side. Your settings are saved as a draft, so you can try
              again without losing anything.
            </span>
          </div>
          <button
            type="button"
            onClick={act.openLaunch}
            className={cn(cls.secondary, "border-[#FECACA] text-[#B91C1C]")}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div
        className="grid items-start gap-6 max-[961px]:!grid-cols-[minmax(0,1fr)]"
        style={{
          gridTemplateColumns: step < 5 ? "minmax(0, 65fr) minmax(0, 35fr)" : "minmax(0, 1fr)",
        }}
      >
        <section
          aria-labelledby="rt-step-title"
          className="min-w-0 rounded-[12px] border border-[#EEF0F3] bg-white"
        >
          <div className="flex flex-col gap-1 px-6 pt-6 max-[641px]:px-4">
            <h2
              id="rt-step-title"
              className="m-0 text-[16px] leading-6 font-semibold tracking-[-0.01em] text-[#111827]"
            >
              {cur.title}
            </h2>
            <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">{cur.desc}</p>
          </div>

          {showBanner ? (
            <div className="px-6 pt-4 max-[641px]:px-4">
              <div
                role="alert"
                className="flex items-center gap-2.5 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[14px] font-medium text-[#B91C1C]"
              >
                <AlertCircleIcon size={16} className="flex-none" />
                {"Fix " + e.count + (e.count === 1 ? " issue" : " issues") + " to continue."}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-6 p-6 max-[641px]:px-4">
            {step === 1 ? <StepSetup s={s} d={d} act={act} /> : null}
            {step === 2 ? <StepTraffic s={s} d={d} act={act} /> : null}
            {step === 3 ? <StepTargeting s={s} d={d} act={act} /> : null}
            {step === 4 ? <StepGoal s={s} d={d} act={act} /> : null}
            {step === 5 ? <StepReview s={s} d={d} act={act} /> : null}
          </div>

          <Footer s={s} d={d} act={act} />
        </section>

        {step < 5 ? <Summary s={s} d={d} act={act} /> : null}
      </div>
    </>
  );
}

function Stepper({ s, d, act }: Props) {
  const step = s.step;
  const att = s.attempted;
  return (
    <nav
      aria-label="Experiment setup steps"
      className="rounded-[12px] border border-[#E5E7EB] bg-white p-2.5 max-[901px]:hidden"
    >
      <ol className="m-0 flex list-none items-center gap-1 p-0">
        {STEPS.map((def) => {
          const n = def.n;
          const current = n === step;
          const isErr = !current && n < 5 && !!att[n] && !d.valid(n);
          const done = !current && !isErr && n <= (s.visited || 1) && n < 5 && d.valid(n);
          const locked = !current && !d.reachable(n);
          const ring = current ? ACCENT : done ? ACCENT_TINT : isErr ? "#FECACA" : "#D1D5DB";
          const bg = current ? ACCENT : done ? ACCENT_TINT : isErr ? "#FEF2F2" : "#FFFFFF";
          const fg = current ? "#FFFFFF" : done ? ACCENT_INK : isErr ? "#B91C1C" : "#6B7280";
          const labelFg = current ? "#111827" : isErr ? "#B91C1C" : done ? "#374151" : "#6B7280";
          return (
            <li key={n} className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (!locked) act.goStep(n);
                }}
                disabled={locked}
                aria-current={current ? "step" : "false"}
                aria-label={
                  "Step " +
                  n +
                  ", " +
                  def.label +
                  (done ? ", complete" : isErr ? ", needs attention" : "")
                }
                className={cn(
                  "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-[8px] border-0 bg-transparent px-2 py-1.5 text-left text-inherit hover:enabled:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] disabled:cursor-default disabled:opacity-45",
                  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
                )}
              >
                <span
                  aria-hidden
                  className="inline-flex size-7 flex-none items-center justify-center rounded-full border-[1.5px] border-solid text-[13px] font-semibold"
                  style={{ borderColor: ring, background: bg, color: fg }}
                >
                  {done ? <CheckIcon size={14} strokeWidth={2.8} /> : isErr ? "!" : n}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[12px] leading-[15px] text-[#6B7280]">Step {n}</span>
                  <span
                    className="truncate text-[14px] leading-[18px] font-semibold"
                    style={{ color: labelFg }}
                  >
                    {def.label}
                  </span>
                </span>
              </button>
              {n < 5 ? (
                <span
                  aria-hidden
                  className="h-0.5 min-w-2 flex-auto rounded-[2px]"
                  style={{ background: n < step || done ? ACCENT_LINE : "#E5E7EB" }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// --- Step 1: setup & variants -----------------------------------------------------------------

/** One URL row in the Pages box. On phones the label and actions share a line above the input. */
const urow =
  "grid grid-cols-[104px_minmax(0,1fr)_72px] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 max-[641px]:grid-cols-[minmax(0,1fr)_auto]";
const uLabel =
  "flex min-w-0 items-center gap-2 text-[13px] font-medium text-[#374151] max-[641px]:col-start-1 max-[641px]:row-start-1";
const uInput = "max-[641px]:col-span-2 max-[641px]:col-start-1 max-[641px]:row-start-2";
const uAct = "flex items-center justify-end gap-1 max-[641px]:col-start-2 max-[641px]:row-start-1";
const uMsg = "col-[2/-1] max-[641px]:col-[1/-1]";

function StepSetup({ s, d, act }: Props) {
  const f = s.form;
  const att = s.attempted;
  const E1 = d.errs[1];
  const showName = !!att[1] && !!E1.name;
  const showControl = !!att[1] && !!E1.control;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="rt-name" className="text-[13px] font-medium text-[#374151]">
          Experiment name
        </label>
        <input
          id="rt-name"
          type="text"
          value={f.name}
          onChange={(ev) => act.setForm({ name: ev.target.value })}
          placeholder="e.g. Fall sale landing page"
          aria-invalid={inv(showName)}
          maxLength={80}
          className={cls.input}
          style={{ borderColor: border(showName) }}
        />
        {showName && s.step === 1 ? <FieldError>{E1.name}</FieldError> : null}
        {!showName ? (
          <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">
            Only your team sees this name.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h3 className={cls.sectionTitle}>Pages</h3>
          <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
            Visitors who land on the Control page are redirected to a variant.
          </p>
        </div>
        <div className="rounded-[12px] border border-[#EEF0F3]">
          <div className={urow}>
            <label htmlFor="rt-cu" className={uLabel}>
              <Swatch color="#6B7280" radius={999} />
              Control
            </label>
            <input
              id="rt-cu"
              type="url"
              value={f.controlUrl}
              onChange={(ev) => act.setForm({ controlUrl: ev.target.value })}
              placeholder={"https://" + s.ctx.domain + "/fall-sale"}
              aria-invalid={inv(showControl)}
              className={cn(cls.input, uInput)}
              style={{ borderColor: border(showControl) }}
            />
            <div className={uAct}>
              {validUrl(f.controlUrl) ? (
                <a
                  href={norm(f.controlUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the Control page in a new tab"
                  className={cls.ghost}
                >
                  <ExternalIcon />
                </a>
              ) : null}
            </div>
            {showControl ? <FieldError className={uMsg}>{E1.control}</FieldError> : null}
            {E1.warn && !showControl ? (
              <FieldWarning className={uMsg}>{E1.warn}</FieldWarning>
            ) : null}
          </div>

          {f.variants.map((v, i) => {
            const ve = E1.variants[v.id] || { name: "", url: "" };
            const showUrl = !!att[1] && !!ve.url;
            const urlId = "rt-vu-" + v.id;
            return (
              <div key={v.id} className={cn(urow, "border-t border-[#EEF0F3]")}>
                <label htmlFor={urlId} className={uLabel}>
                  <Swatch color={colorOf(v)} radius={999} />
                  <span className="truncate">{v.name}</span>
                </label>
                <input
                  id={urlId}
                  type="url"
                  value={v.url}
                  onChange={(ev) => {
                    const url = ev.target.value;
                    act.setForm((cur) => ({
                      variants: cur.variants.map((x) => (x.id === v.id ? { ...x, url } : x)),
                    }));
                  }}
                  placeholder={"https://" + s.ctx.domain + "/fall-sale-v" + (i + 2)}
                  aria-invalid={inv(showUrl)}
                  className={cn(cls.input, uInput)}
                  style={{ borderColor: border(showUrl) }}
                />
                <div className={uAct}>
                  {validUrl(v.url) ? (
                    <a
                      href={norm(v.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={"Open " + v.name + " in a new tab"}
                      className={cls.ghost}
                    >
                      <ExternalIcon />
                    </a>
                  ) : null}
                  {f.variants.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => act.removeVariant(v.id)}
                      aria-label={"Remove " + v.name}
                      className={cls.ghost}
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
                {showUrl ? <FieldError className={uMsg}>{ve.url}</FieldError> : null}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[#EEF0F3] px-3.5 py-2">
            <button
              type="button"
              onClick={act.addVariant}
              disabled={f.variants.length >= MAX_VARIANTS}
              className={cn(cls.link, cls.tall, "-ml-1.5 h-[34px] gap-1.5 px-1.5")}
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
      </div>

      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={f.keepParams}
          onChange={() => act.setForm((cur) => ({ keepParams: !cur.keepParams }))}
          className="m-0 size-[18px] flex-none"
          style={{ accentColor: ACCENT }}
        />
        <span className="text-[14px] leading-5 text-[#374151]">
          Keep URL parameters like{" "}
          <code className="rounded-[5px] bg-[#F3F4F6] px-[5px] py-px font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[13px]">
            utm_source
          </code>{" "}
          when redirecting
        </span>
      </label>
    </>
  );
}

// --- Step 2: traffic --------------------------------------------------------------------------

function StepTraffic({ s, d, act }: Props) {
  const f = s.form;
  const E2 = d.errs[2];
  const sh2 = !!s.attempted[2];
  const incNum = parseInt(f.include, 10);
  const incPct = isNaN(incNum) ? 0 : Math.min(100, Math.max(0, incNum));
  const ctrlHost = validUrl(f.controlUrl) ? host(f.controlUrl) : "";
  const urlOk = validUrl(f.controlUrl);
  // The real baseline is the saved Control URL's visitors/day over 30 days (`pageBaseline`).
  const baseline = urlOk ? s.ctx.baseline : null;
  const totalOk = E2.total === 100 && !E2.split;
  const arms = d.arms;

  const pathOf = (u: string) => {
    const tt = String(u || "").trim();
    if (!tt) return "No URL yet";
    if (!validUrl(tt)) return tt;
    const rest = norm(tt).replace(/^https?:\/\/[^/?#]+/i, "") || "/";
    return host(tt) === ctrlHost ? rest : shortUrl(tt);
  };

  const segs = arms
    .map((a) => {
      const pc = d.pct(a.id);
      const nm = a.name.trim() || "Variant";
      const mm = /^Variant\s+(\S+)$/i.exec(nm);
      const shortName = a.id === "control" ? "Control" : mm ? mm[1] : nm;
      const tot = Math.max(E2.total, 100);
      return {
        id: a.id,
        width: ((pc / tot) * 100).toFixed(2) + "%",
        color: colorOf(a),
        fg: LABEL_FG[a.color] ?? "#FFFFFF",
        label: pc >= 14 ? shortName + " · " + pc + "%" : pc >= 6 ? pc + "%" : "",
      };
    })
    .filter((b) => parseFloat(b.width) > 0);
  const splitAria =
    "Traffic split: " +
    arms.map((a) => (a.name.trim() || "Variant") + " " + d.pct(a.id) + "%").join(", ");
  const incDisplay = (isNaN(incNum) ? "—" : incNum) + "%";
  const incCaption = baseline
    ? (incPct >= 100
        ? "All matching visitors enter the experiment."
        : incPct +
          "% of matching visitors enter the experiment, about " +
          fmt(Math.round((baseline * incPct) / 100)) +
          " a day. Everyone else sees the Control page as usual.") +
      " Based on ~" +
      fmt(baseline) +
      " visitors/day to this page over the last 30 days."
    : urlOk
      ? (incPct >= 100
          ? "All matching visitors enter the experiment."
          : incPct +
            "% of matching visitors enter the experiment. Everyone else sees the Control page as usual.") +
        " No traffic estimate yet — this page hasn’t reported any visits in the last 30 days."
      : "Add a valid Control URL in step 1 to see traffic estimates for this page.";

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className={cls.sectionTitle}>Split between versions</h3>
          <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
            How visitors in the experiment are divided between your pages.
          </p>
        </div>
        <div
          role="img"
          aria-label={splitAria}
          className="flex h-[52px] gap-0.5 overflow-hidden rounded-[8px] bg-[#F3F4F6]"
        >
          {segs.map((b) => (
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
              background: totalOk ? "#DCFCE7" : "#FEF2F2",
              color: totalOk ? "#166534" : "#B91C1C",
            }}
          >
            {totalOk ? (
              <CheckIcon size={14} strokeWidth={2.6} />
            ) : (
              <AlertCircleIcon size={14} strokeWidth={2.2} />
            )}
            Total {E2.total}%
          </span>
          <button
            type="button"
            onClick={act.splitEvenly}
            className={cn(cls.secondary, cls.tall, "px-3")}
          >
            <BarsIcon />
            Split evenly
          </button>
        </div>
        <div className="flex flex-col border-t border-[#EEF0F3]">
          {arms.map((a) => {
            const bad = sh2 && (E2.low[a.id] || (E2.split && !E2.low[a.id] && E2.total !== 100));
            const pc = d.pct(a.id);
            const name = a.name.trim() || "Unnamed variant";
            const value = f.split[a.id] != null ? f.split[a.id] : "";
            const inputId = "rt-sp-" + a.id;
            return (
              <div
                key={a.id}
                className="grid grid-cols-[minmax(120px,1fr)_minmax(0,2fr)_auto] items-center gap-x-6 gap-y-2.5 border-b border-[#EEF0F3] py-4 max-[641px]:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="flex min-w-0 items-start gap-2.5 max-[641px]:col-start-1 max-[641px]:row-start-1">
                  <Swatch color={colorOf(a)} size={10} radius={3} className="mt-[5px]" />
                  <span className="flex min-w-0 flex-col">
                    <label
                      htmlFor={inputId}
                      className="truncate text-[13px] leading-5 font-medium text-[#374151]"
                    >
                      {name}
                    </label>
                    <span className="truncate text-[13px] leading-[18px] text-[#6B7280]">
                      {pathOf(a.url)}
                    </span>
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-1 max-[641px]:col-span-2 max-[641px]:col-start-1 max-[641px]:row-start-2">
                  <input
                    type="range"
                    min={1}
                    max={100 - (arms.length - 1)}
                    step={1}
                    value={Math.max(1, pc)}
                    onChange={(ev) => act.applySplit(a.id, ev.target.value)}
                    aria-label={name + " traffic share"}
                    aria-valuetext={value + "%"}
                    className="m-0 w-full"
                    style={{ accentColor: ACCENT }}
                  />
                  <span className="text-[13px] leading-[18px] text-[#6B7280]">
                    {baseline
                      ? "≈ " +
                        fmt(Math.round((((baseline * incPct) / 100) * pc) / 100)) +
                        " visitors / day"
                      : "No traffic estimate yet"}
                  </span>
                </div>
                <div className="flex items-center gap-2 max-[641px]:col-start-2 max-[641px]:row-start-1">
                  <input
                    id={inputId}
                    type="text"
                    inputMode="numeric"
                    value={value}
                    onChange={(ev) => act.applySplit(a.id, ev.target.value)}
                    aria-invalid={inv(bad)}
                    className={cn(cls.input, "w-16 px-2 text-center font-semibold tabular-nums")}
                    style={{ borderColor: border(bad) }}
                  />
                  <span aria-hidden className="text-[14px] font-semibold text-[#6B7280]">
                    %
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {sh2 && E2.split ? <FieldError alert>{E2.split}</FieldError> : null}
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
            {incDisplay}
          </span>
        </div>
        <input
          id="rt-inc"
          type="range"
          min={1}
          max={100}
          step={1}
          value={isNaN(incNum) ? 1 : Math.min(100, Math.max(1, incNum))}
          onChange={(ev) => act.setInclude(ev.target.value)}
          aria-valuetext={incDisplay + " of visitors included"}
          className="m-0 w-full"
          style={{ accentColor: ACCENT }}
        />
        <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">{incCaption}</p>
        {sh2 && E2.include ? <FieldError>{E2.include}</FieldError> : null}
      </div>
    </>
  );
}

// --- Step 3: targeting ------------------------------------------------------------------------

const DEVICES = [
  { key: "desktop", label: "Desktop", Icon: DesktopIcon },
  { key: "mobile", label: "Mobile", Icon: MobileIcon },
  { key: "tablet", label: "Tablet", Icon: TabletIcon },
] as const;

function StepTargeting({ s, d, act }: Props) {
  const f = s.form;
  const isAll = f.targeting === "all";
  const legend = "mb-3 p-0 text-[14px] leading-5 font-semibold text-[#111827]";
  const fieldset = "m-0 flex min-w-0 flex-col gap-3 border-0 p-0";
  return (
    <>
      <fieldset className={fieldset}>
        <legend className={legend}>Who can enter the experiment</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
          <label
            className={cn(cls.option, "flex items-start gap-3 p-4")}
            style={{
              borderColor: isAll ? ACCENT : "#E5E7EB",
              background: isAll ? ACCENT_WASH : "#FFFFFF",
            }}
          >
            <input
              type="radio"
              name="rt-target"
              checked={isAll}
              onChange={() => act.setForm({ targeting: "all" })}
              className="m-0 mt-px size-[18px] flex-none"
              style={{ accentColor: ACCENT }}
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-[#111827]">All visitors</span>
                <Chip>Default</Chip>
              </span>
              <span className="text-[13px] leading-[19px] text-[#6B7280]">
                Anyone who visits the Control page can enter, on any device.
              </span>
            </span>
          </label>
          <label
            className={cn(cls.option, "flex items-start gap-3 p-4")}
            style={{
              borderColor: !isAll ? ACCENT : "#E5E7EB",
              background: !isAll ? ACCENT_WASH : "#FFFFFF",
            }}
          >
            <input
              type="radio"
              name="rt-target"
              checked={!isAll}
              onChange={() => act.setForm({ targeting: "specific" })}
              className="m-0 mt-px size-[18px] flex-none"
              style={{ accentColor: ACCENT }}
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-[14px] font-semibold text-[#111827]">Specific devices</span>
              <span className="text-[13px] leading-[19px] text-[#6B7280]">
                Only include visitors on the device types you choose.
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      {!isAll ? (
        <fieldset className={fieldset}>
          <legend className={legend}>Devices</legend>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-3">
            {DEVICES.map(({ key, label, Icon }) => {
              const on = f.devices[key];
              return (
                <label
                  key={key}
                  className={cn(cls.option, "flex min-h-16 items-center gap-3 px-3.5 py-3")}
                  style={{
                    borderColor: on ? ACCENT : "#E5E7EB",
                    background: on ? ACCENT_WASH : "#FFFFFF",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => act.toggleDevice(key)}
                    className="m-0 size-[18px] flex-none"
                    style={{ accentColor: ACCENT }}
                  />
                  <Icon className="text-[#4B5563]" />
                  <span className="text-[14px] font-semibold text-[#111827]">{label}</span>
                </label>
              );
            })}
          </div>
          {s.attempted[3] && d.errs[3].devices ? (
            <FieldError alert>{d.errs[3].devices}</FieldError>
          ) : null}
          <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">
            {f.devices.desktop && f.devices.mobile && f.devices.tablet
              ? "All three device types are selected, which is the same as All visitors."
              : "Visitors on other devices see the Control page as usual and aren’t counted."}
          </p>
        </fieldset>
      ) : null}
    </>
  );
}

// --- Step 4: goal -----------------------------------------------------------------------------

function StepGoal({ s, d, act }: Props) {
  const f = s.form;
  const showUrl = !!s.attempted[4] && !!d.errs[4].url;
  return (
    <>
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-3 p-0 text-[14px] leading-5 font-semibold text-[#111827]">
          Goal type
        </legend>
        <label
          className="flex cursor-pointer items-start gap-3 rounded-[12px] border-[1.5px] border-solid p-4"
          style={{ borderColor: ACCENT_LINE, background: ACCENT_WASH }}
        >
          <input
            type="radio"
            name="rt-goaltype"
            checked
            onChange={() => {}}
            className="m-0 mt-px size-[18px] flex-none"
            style={{ accentColor: ACCENT }}
          />
          <span
            aria-hidden
            className="inline-flex size-8 flex-none items-center justify-center rounded-[8px] border bg-white"
            style={{ color: ACCENT_INK, borderColor: ACCENT_LINE }}
          >
            <VisitIcon />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-[14px] font-semibold text-[#111827]">Page visit</span>
            <span className="text-[13px] leading-[19px] text-[#6B7280]">
              A conversion counts when a visitor from any version reaches a specific page, such as
              an order confirmation.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="rt-gu" className="text-[13px] font-medium text-[#374151]">
          Conversion URL
        </label>
        <input
          id="rt-gu"
          type="url"
          value={f.goalUrl}
          onChange={(ev) => act.setForm({ goalUrl: ev.target.value })}
          placeholder={"https://" + s.ctx.domain + "/checkout/thank-you"}
          aria-invalid={inv(showUrl)}
          className={cls.input}
          style={{ borderColor: border(showUrl) }}
        />
        {showUrl ? <FieldError>{d.errs[4].url}</FieldError> : null}
        <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">
          Visits to this exact URL count as conversions.
        </p>
      </div>

      <div className="flex items-start gap-2.5 rounded-[8px] bg-[#F9FAFB] px-3.5 py-3">
        <InfoIcon size={16} strokeWidth={1.8} className="mt-0.5 flex-none text-[#4B5563]" />
        <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#374151]">
          Pick a page visitors reach <strong>after</strong> the page you’re testing. If the
          conversion page were a variant itself, every visitor sent there would count as converted.
        </p>
      </div>
    </>
  );
}

// --- Step 5: review & tracking ----------------------------------------------------------------

function StepReview({ s, d, act }: Props) {
  const f = s.form;
  const tr = s.tracking;
  const incNum = parseInt(f.include, 10);
  const issues = [1, 2, 3, 4].filter((n) => !d.valid(n));
  const editBtn = (n: number) => (
    <button
      type="button"
      onClick={() => act.goStep(n)}
      className={cn(cls.link, "h-8 rounded-none px-1.5")}
    >
      Edit
    </button>
  );
  const head = (title: string, n: number) => (
    <div className="flex items-center justify-between gap-3">
      <h3 className="m-0 text-[14px] font-semibold text-[#111827]">{title}</h3>
      {editBtn(n)}
    </div>
  );

  const missing = d.missing;
  const allOk = d.allOk;
  const checking = tr.status === "checking";
  const pill = checking
    ? "Checking…"
    : tr.status === "error"
      ? "Couldn’t check"
      : d.stale || tr.status === "idle"
        ? "Not checked"
        : missing.length
          ? missing.length +
            (missing.length === 1 ? " page needs tracking" : " pages need tracking")
          : "All pages ready";
  const pillBg = checking
    ? "#F3F4F6"
    : tr.status === "error"
      ? "#FEF2F2"
      : allOk
        ? "#DCFCE7"
        : "#FEF3C7";
  const pillFg = checking
    ? "#4B5563"
    : tr.status === "error"
      ? "#B91C1C"
      : allOk
        ? "#166534"
        : "#92400E";

  return (
    <>
      <div className="flex flex-col rounded-[12px] border border-[#EEF0F3]">
        <div className="flex flex-col gap-2.5 p-4">
          {head("Setup & variants", 1)}
          <span className="text-[14px] font-medium text-[#111827]">
            {f.name.trim() || "Untitled experiment"}
          </span>
          <div className="flex flex-col gap-2">
            {d.rvArms.map((a) => (
              <div
                key={a.id}
                className="grid grid-cols-[10px_minmax(0,120px)_minmax(0,1fr)] items-center gap-2.5 text-[14px]"
              >
                <Swatch color={a.color} size={10} radius={3} />
                <span className="truncate font-semibold text-[#374151]">{a.name}</span>
                <span className="truncate text-[#4B5563]">{a.url}</span>
              </div>
            ))}
          </div>
          <span className="text-[13px] text-[#6B7280]">
            {f.keepParams
              ? "URL parameters are kept when visitors are redirected."
              : "URL parameters are dropped when visitors are redirected."}
          </span>
        </div>
        <div className="flex flex-col gap-2.5 border-t border-[#EEF0F3] p-4">
          {head("Traffic", 2)}
          <span className="text-[14px] text-[#374151]">
            {(isNaN(incNum) ? "—" : incNum) +
              "% of visitors on the Control page enter the experiment"}
          </span>
          <SplitBar bars={d.splitBar} />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {d.rvArms.map((a) => (
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
            {head("Targeting", 3)}
            <span className="text-[14px] text-[#374151]">{d.targetText}</span>
          </div>
          <div className="flex min-w-0 flex-[2_1_280px] flex-col gap-1.5">
            {head("Goal", 4)}
            <span className="text-[14px] text-[#374151]">Page visit</span>
            <span className="truncate text-[13px] text-[#4B5563]">{d.goalUrlText}</span>
          </div>
        </div>
      </div>

      {issues.length ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
        >
          <span className="text-[14px] font-semibold text-[#B91C1C]">
            Finish these steps before launching
          </span>
          {issues.map((n) => {
            const c = d.errs[n as 1 | 2 | 3 | 4].count;
            return (
              <div key={n} className="flex items-center justify-between gap-3">
                <span className="text-[14px] text-[#B91C1C]">
                  {STEPS[n - 1]?.label + ": " + c + (c === 1 ? " issue" : " issues")}
                </span>
                <button
                  type="button"
                  onClick={() => act.fix(n)}
                  className={cn(cls.secondary, "h-8 border-[#FECACA] px-3 text-[#B91C1C]")}
                >
                  Fix
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-col gap-3.5 rounded-[12px] border border-[#EEF0F3] p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2.5">
            <CodeIcon className="text-[#374151]" />
            <h3 className="m-0 text-[14px] font-semibold text-[#111827]">Tracking installation</h3>
          </div>
          <span
            aria-live="polite"
            className="inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-semibold whitespace-nowrap"
            style={{ background: pillBg, color: pillFg }}
          >
            {pill}
          </span>
        </div>
        <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
          The Routely snippet must be on every page in this experiment so visitors can be redirected
          and conversions counted.
        </p>

        {tr.status !== "error" ? (
          <div className="flex flex-col rounded-[8px] border border-[#EEF0F3]">
            {d.pages.map((pg, i) => {
              const stt = checking
                ? "checking"
                : tr.status === "done" && !d.stale
                  ? tr.results[pg.id] || "ok"
                  : "idle";
              const iconBg = stt === "ok" ? "#DCFCE7" : stt === "missing" ? "#FEF3C7" : "#F3F4F6";
              const iconFg = stt === "ok" ? "#166534" : stt === "missing" ? "#92400E" : "#6B7280";
              const text =
                stt === "checking"
                  ? "Checking…"
                  : stt === "ok"
                    ? "Snippet found"
                    : stt === "missing"
                      ? "Snippet not found"
                      : "Not checked";
              return (
                <div
                  key={pg.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                  style={{ borderTop: "1px solid " + (i === 0 ? "transparent" : "#EEF0F3") }}
                >
                  <span
                    aria-hidden
                    className="inline-flex size-[22px] flex-none items-center justify-center rounded-full"
                    style={{ background: iconBg, color: iconFg }}
                  >
                    {stt === "checking" ? <Spinner size={13} strokeWidth={2.6} /> : null}
                    {stt === "ok" ? <CheckIcon size={13} strokeWidth={3} /> : null}
                    {stt === "missing" ? <BangIcon /> : null}
                  </span>
                  <span className="flex min-w-0 flex-auto flex-col">
                    <span className="text-[14px] font-semibold text-[#374151]">{pg.label}</span>
                    <span className="truncate text-[13px] text-[#6B7280]">{pg.url}</span>
                  </span>
                  <span
                    className="text-[13px] font-medium whitespace-nowrap"
                    style={{ color: iconFg }}
                  >
                    {text}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {tr.status === "error" ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-3"
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
                Some pages didn’t respond. Make sure each URL is public and loads in a browser, then
                try again.
              </span>
            </span>
          </div>
        ) : null}

        {missing.length ? (
          <div className="flex items-start gap-2.5 rounded-[8px] border border-[#FDE68A] bg-[#FEF3C7] px-3.5 py-3">
            <WarningIcon size={18} strokeWidth={1.8} className="mt-px flex-none text-[#92400E]" />
            <span className="text-[13px] leading-[19px] text-[#92400E]">
              {"We couldn’t find the Routely snippet on " +
                missing.map((m) => m.url).join(", ") +
                ". Without it, visitors on " +
                (missing.length === 1 ? "that page" : "those pages") +
                " won’t be counted."}
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {missing.length > 0 || tr.status === "error" ? (
            <button
              type="button"
              onClick={act.openInstall}
              className={cn(cls.primary, cls.tall, "px-3.5")}
            >
              <CodeIcon size={15} strokeWidth={2} />
              Install tracking
            </button>
          ) : null}
          <button
            type="button"
            onClick={act.recheck}
            disabled={checking}
            className={cn(cls.secondary, cls.tall)}
          >
            <RefreshIcon />
            {checking ? "Checking…" : tr.status === "error" ? "Try again" : "Check again"}
          </button>
        </div>
      </div>
    </>
  );
}

function SplitBar({ bars }: { bars: { width: string; color: string }[] }) {
  return (
    <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-[#F3F4F6]">
      {bars.map((b, i) => (
        <span
          key={i}
          className="block h-full flex-none"
          style={{ width: b.width, background: b.color }}
        />
      ))}
    </div>
  );
}

// --- Footer -----------------------------------------------------------------------------------

function Footer({ s, d, act }: Props) {
  const step = s.step;
  const tr = s.tracking;
  const hint = !d.allValid
    ? "Finish every step to launch."
    : tr.status === "checking"
      ? "Checking tracking…"
      : tr.status === "error"
        ? "Check tracking to launch."
        : d.missing.length || d.stale || tr.status === "idle"
          ? "Install tracking on every page to launch."
          : "Everything’s ready to go.";
  const stretch = "max-[641px]:h-11 max-[641px]:flex-auto";
  // The review buttons don't centre their label when stretched on phones; the reference doesn't.
  const stretchStart = stretch + " max-[641px]:justify-start";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0F3] px-6 py-4 max-[641px]:p-4">
      <div className="flex">
        {step > 1 ? (
          <button type="button" onClick={act.back} className={cn(cls.secondary, cls.tall)}>
            <ArrowLeftIcon />
            Back
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-2 max-[641px]:w-full">
        {step === 5 ? (
          <>
            <span
              className="text-[13px] max-[641px]:flex-[1_1_100%] max-[641px]:text-left"
              style={{ color: d.canLaunch ? "#166534" : "#6B7280" }}
            >
              {hint}
            </span>
            <button
              type="button"
              onClick={act.saveDraft}
              className={cn(cls.secondary, stretchStart)}
            >
              Save as draft
            </button>
            <button
              type="button"
              onClick={act.openLaunch}
              disabled={!d.canLaunch}
              className={cn(cls.primary, stretchStart)}
            >
              <RocketIcon />
              Launch experiment
            </button>
          </>
        ) : (
          <button type="button" onClick={act.next} className={cn(cls.primary, stretch)}>
            {step === 4 ? "Review" : "Continue"}
            <ArrowRightIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Summary aside ----------------------------------------------------------------------------

function Summary({ s, d, act }: Props) {
  const f = s.form;
  const step = s.step;
  const E2 = d.errs[2];
  const splitOk = E2.total === 100 && !E2.split;
  const readyCount = [1, 2, 3, 4].filter((k) => d.valid(k)).length;
  const incNum = parseInt(f.include, 10);
  const arms = d.arms.map((a) => ({
    id: a.id,
    name: a.name.trim() || "Unnamed variant",
    url: a.url.trim() ? shortUrl(a.url) : "URL not set yet",
    urlFg: a.url.trim() ? "#4B5563" : "#6B7280",
    color: colorOf(a),
    pct: d.pct(a.id) + "%",
  }));
  const section = "flex flex-col px-[22px] py-[18px]";
  const head = (title: string, k: number, aria: string) => (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <h3 className={cls.eyebrow}>{title}</h3>
      {k !== step && d.reachable(k) ? (
        <button
          type="button"
          onClick={() => act.goStep(k)}
          aria-label={aria}
          className={cn(cls.link, "h-7 rounded-none px-1")}
        >
          Edit
        </button>
      ) : null}
    </div>
  );

  return (
    <aside
      aria-label="Experiment summary"
      className="sticky top-6 flex min-w-0 flex-col self-start rounded-[12px] border border-[#EEF0F3] bg-white max-[1200px]:static"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#EEF0F3] px-[22px] pt-5 pb-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 text-[16px] leading-6 font-semibold text-[#111827]">Summary</h2>
          <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
            Updates as you fill in each step.
          </p>
        </div>
        <span
          className="inline-flex h-6 flex-none items-center rounded-[6px] px-2 text-[12px] font-semibold whitespace-nowrap"
          style={{
            background: readyCount === 4 ? "#DCFCE7" : "#F3F4F6",
            color: readyCount === 4 ? "#166534" : "#4B5563",
          }}
        >
          {readyCount} of 4 steps ready
        </span>
      </div>

      <section aria-label="Pages" className={cn(section, "gap-3.5 border-b border-[#EEF0F3]")}>
        {head("Pages · " + d.arms.length + " versions", 1, "Edit pages")}
        {arms.map((a) => (
          <div key={a.id} className="flex min-w-0 items-start gap-2.5">
            <Swatch color={a.color} size={10} radius={3} className="mt-[5px]" />
            <span className="flex min-w-0 flex-auto flex-col gap-0.5">
              <span className="text-[14px] leading-5 font-semibold text-[#374151]">{a.name}</span>
              <span
                className="text-[14px] leading-5 [overflow-wrap:anywhere]"
                style={{ color: a.urlFg }}
              >
                {a.url}
              </span>
            </span>
          </div>
        ))}
      </section>

      <section aria-label="Traffic" className={cn(section, "gap-3 border-b border-[#EEF0F3]")}>
        {head("Traffic", 2, "Edit traffic")}
        <span className="text-[14px] leading-5 text-[#374151]">
          {(isNaN(incNum) ? "—" : incNum) + "% of visitors on the Control page are included"}
        </span>
        <SplitBar bars={d.splitBar} />
        <div className="flex flex-col gap-2">
          {arms.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 text-[14px] leading-5"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <Swatch color={a.color} />
                <span className="truncate text-[#374151]">{a.name}</span>
              </span>
              <span className="font-semibold text-[#111827] tabular-nums">{a.pct}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-dashed border-[#E5E7EB] pt-2 text-[14px] leading-5">
            <span className="text-[#6B7280]">Total</span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: splitOk ? "#166534" : "#B91C1C" }}
            >
              {E2.total}%
            </span>
          </div>
        </div>
      </section>

      <section aria-label="Targeting" className={cn(section, "gap-1.5 border-b border-[#EEF0F3]")}>
        {head("Targeting", 3, "Edit targeting")}
        <span className="text-[14px] leading-5 font-medium text-[#374151]">{d.targetText}</span>
        <span className="text-[13px] leading-[19px] text-[#6B7280]">
          {f.targeting === "all"
            ? "Desktop, mobile and tablet visitors can enter."
            : "Visitors on other devices see the Control page."}
        </span>
      </section>

      <section aria-label="Goal" className={cn(section, "gap-1.5 pb-5")}>
        {head("Goal", 4, "Edit goal")}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] leading-5 font-semibold text-[#374151]">Page visit</span>
        </div>
        <span
          className="text-[14px] leading-5 [overflow-wrap:anywhere]"
          style={{ color: f.goalUrl.trim() ? "#4B5563" : "#6B7280" }}
        >
          {f.goalUrl.trim() ? shortUrl(f.goalUrl) : "Conversion URL not set yet"}
        </span>
      </section>
    </aside>
  );
}
