"use client";

import { ArmTile, FieldError, IssueIcon, Section, Tag, TextInput } from "@/components/rl";
import { ARM_NAMES, MAX_ARMS } from "@/lib/domain";
import { hostOf } from "@/lib/domain-normalize";
import { changeCount, changeLabel } from "@/lib/editor";
import { addArm } from "@/lib/validate-draft";
import { cn } from "@/lib/utils";

import type { StepProps, UrlCheckEntry } from "./types";
import { StepHeading, UrlCheckLine } from "./ui";

interface VariantsProps extends StepProps {
  urlCheck: (url: string) => UrlCheckEntry | undefined;
  onCheckUrl: (url: string) => void;
  onRemoveArm: (i: number) => void;
  onOpenEditor: (arm: number) => void;
}

/** Step 3 — Variants: Split URL rows (L867–903) or A/B variant cards (L905–964). */
export function StepVariants(props: VariantsProps) {
  return props.draft.type === "redirect" ? <SplitVariants {...props} /> : <AbVariants {...props} />;
}

function addLabel(n: number): string {
  return "+ Add " + (ARM_NAMES[n] ?? "variant");
}

function SplitVariants({ draft, update, err, urlCheck, onCheckUrl, onRemoveArm }: VariantsProps) {
  const ctrlHost = hostOf(draft.url.trim());
  return (
    <>
      <StepHeading title="Control and variant URLs">
        Visitors who land on the control URL are assigned once and always see the same version on
        return visits. UTM, GCLID, FBCLID and other query parameters are carried over automatically,
        and search engines and bots always see the control.
      </StepHeading>
      <Section as="div" clip>
        <div className="flex items-start gap-3.5 border-b border-divider bg-[#FAFBFC] px-5 py-[18px]">
          <ArmTile position={0} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-extrabold">
                Control <span className="font-semibold text-ink-3">· original page</span>
              </span>
              <span className="text-[12.5px] text-ink-3">
                {draft.arms[0]?.weight ?? 0}% of traffic
              </span>
            </div>
            <div className="mt-1.5 rounded-lg border border-border bg-white px-3 py-[9px] font-mono text-[13px] break-all">
              {draft.url || "Set the control URL in Basics"}
            </div>
          </div>
        </div>
        {draft.arms.slice(1).map((a, j) => {
          const i = j + 1;
          const e = err("variants", "v" + i);
          const h = hostOf(a.url.trim());
          const cross = !!h && !!ctrlHost && h !== ctrlHost && !e;
          return (
            <div
              key={i}
              className="flex items-start gap-3.5 border-b border-divider px-5 py-[18px]"
            >
              <ArmTile position={i} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-extrabold">
                    {a.name} <span className="font-semibold text-ink-3">· redirect to</span>
                  </span>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[12.5px] text-ink-3">{a.weight}% of traffic</span>
                    {draft.arms.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => onRemoveArm(i)}
                        className="cursor-pointer border-0 bg-transparent text-[12.5px] font-bold text-danger-text"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
                <TextInput
                  aria-label={`${a.name} URL`}
                  name={`v${i}`}
                  mono
                  inputMode="url"
                  className="text-[13.5px]"
                  value={a.url}
                  invalid={!!e}
                  placeholder="https://example.com/new-landing-page"
                  onChange={(ev) => {
                    const v = ev.target.value;
                    update((d) => ({
                      ...d,
                      arms: d.arms.map((x, k) => (k === i ? { ...x, url: v } : x)),
                    }));
                  }}
                  onBlur={() => onCheckUrl(a.url)}
                />
                <FieldError>{e}</FieldError>
                {!e ? <UrlCheckLine entry={urlCheck(a.url)} url={a.url} withIcon={false} /> : null}
                {cross ? (
                  <span className="text-[12.5px] font-semibold text-[#94600A]">
                    Different domain from control. Make sure the Routely script is installed on {h}{" "}
                    so conversions are attributed.
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
        {draft.arms.length < MAX_ARMS ? (
          <button
            type="button"
            onClick={() => update(addArm)}
            className="h-12 w-full cursor-pointer border-0 bg-white text-[13.5px] font-extrabold text-brand hover:bg-brand-tint"
          >
            {addLabel(draft.arms.length)}
          </button>
        ) : null}
      </Section>
    </>
  );
}

function AbVariants({ draft, update, err, onRemoveArm, onOpenEditor }: VariantsProps) {
  return (
    <>
      <StepHeading title="Build your variants">
        Control is your live page, untouched. Each variant stores its own changes, applied only for
        visitors assigned to it.
      </StepHeading>
      {draft.arms.map((a, i) => {
        if (i === 0) {
          return (
            <div
              key={i}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-[#FAFBFC] px-5 py-4"
            >
              <ArmTile position={0} size={32} />
              <div className="min-w-0 flex-[1_1_220px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14.5px] font-extrabold">Control</span>
                  <Tag upper={false}>Original page</Tag>
                </div>
                <div className="mt-[3px] text-[13px] text-ink-3">
                  Your live page as it is today. No changes needed. Gets {a.weight}% of traffic.
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenEditor(0)}
                className="h-9 cursor-pointer rounded-md border border-input bg-white px-3.5 text-[13px] font-bold hover:border-navy"
              >
                View original
              </button>
            </div>
          );
        }
        const n = a.changes.length;
        const e = err("variants", "v" + i);
        const req = i === 1;
        return (
          <div
            key={i}
            className={cn(
              "overflow-hidden rounded-lg border bg-white transition-[border-color,box-shadow]",
              e
                ? "border-[#E59A8A] shadow-[0_0_0_3px_rgba(209,59,59,0.10)]"
                : n
                  ? "border-border"
                  : "border-input",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
              <ArmTile position={i} size={32} glyph={a.name.slice(-1)} />
              <div className="min-w-0 flex-[1_1_220px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14.5px] font-extrabold">{a.name}</span>
                  <span
                    className={cn(
                      "rounded-sm px-2 py-0.5 text-[11.5px] font-bold",
                      req ? "bg-brand-tint-2 text-[#1F3FB0]" : "bg-divider text-ink-2",
                    )}
                  >
                    {req ? "Required" : "Optional"}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-[5px] text-xs font-bold",
                      n ? "text-success-text" : e ? "text-danger-text" : "text-[#94600A]",
                    )}
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: n ? "#13A06B" : e ? "#D13B3B" : "#E0A526" }}
                    />
                    {n ? changeCount(n) : "No changes yet"}
                  </span>
                </div>
                <div className="mt-[3px] text-[13px] text-ink-3">
                  {n
                    ? `${a.weight}% of traffic · applied only to visitors assigned to ${a.name}`
                    : `${a.weight}% of traffic · ${req ? "needs at least one change" : "needs its own changes if kept"}`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {draft.arms.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => onRemoveArm(i)}
                    className="h-9 cursor-pointer border-0 bg-transparent px-2.5 text-[13px] font-bold text-ink-3 hover:text-danger-text"
                  >
                    Remove
                  </button>
                ) : null}
                {n ? (
                  <button
                    type="button"
                    onClick={() => onOpenEditor(i)}
                    className="h-9 cursor-pointer rounded-md border border-input bg-white px-3.5 text-[13px] font-bold hover:border-brand hover:text-brand"
                  >
                    Edit changes
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenEditor(i)}
                    className="h-[38px] cursor-pointer rounded-md border border-brand bg-brand px-4 text-[13.5px] font-extrabold text-white hover:bg-brand-hover"
                  >
                    Open visual editor →
                  </button>
                )}
              </div>
            </div>
            {n ? (
              <div className="flex flex-col gap-[7px] border-t border-divider py-3 pr-5 pb-3.5 pl-5 sm:pl-[68px]">
                {a.changes.map((c, k) => (
                  <div key={k} className="flex flex-wrap items-baseline gap-3 text-[13px]">
                    <span className="shrink-0 text-[11px] font-black text-success-text">✓</span>
                    <span className="min-w-[140px] font-bold text-ink-2">{changeLabel(c)}</span>
                    <span className="min-w-0 flex-1 break-words text-foreground">“{c.value}”</span>
                  </div>
                ))}
              </div>
            ) : null}
            {!n && !e ? (
              <div className="border-t border-divider py-3 pr-5 pb-3.5 pl-5 text-[13px] leading-normal text-ink-3 sm:pl-[68px]">
                {a.name} currently looks identical to Control. Open the visual editor and change at
                least one headline, button, image or text block.
              </div>
            ) : null}
            {e ? (
              <div
                role="alert"
                className="flex items-start gap-3 border-t border-danger-border bg-[#FFF7F5] px-5 pt-3 pb-3.5"
              >
                <IssueIcon kind="block" className="mt-px ml-1.5" />
                <div className="text-[13px] leading-normal text-[#7A2E1D]">
                  {n ? (
                    <b className="text-danger-text">{e}</b>
                  ) : (
                    <>
                      <b className="text-danger-text">{a.name} needs at least one change.</b>{" "}
                      {req
                        ? "Open the visual editor to make an edit, then continue."
                        : "Open the visual editor to make an edit, or remove this variant."}
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {draft.arms.length < MAX_ARMS ? (
        <button
          type="button"
          onClick={() => update(addArm)}
          className="flex cursor-pointer items-center gap-3.5 rounded-lg border-[1.5px] border-dashed border-[#CBD1DC] bg-transparent px-5 py-3.5 text-left hover:border-brand hover:bg-[#F8FAFF]"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-md border-[1.5px] border-dashed border-[#9AA5BA] text-lg text-ink-3">
            +
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-brand">
                {addLabel(draft.arms.length)}
              </span>
              <span className="rounded-sm bg-divider px-2 py-0.5 text-[11.5px] font-bold text-ink-3">
                Optional
              </span>
            </span>
            <span className="mt-0.5 block text-[12.5px] text-ink-3">
              Test another idea against Control. It needs its own changes, and traffic is re-split
              evenly.
            </span>
          </span>
        </button>
      ) : null}
    </>
  );
}
