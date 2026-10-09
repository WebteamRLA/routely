"use client";

import type { ReactNode } from "react";

import { ArmSwatch, FieldError, TextInput } from "@/components/rl";
import { ARM_NAMES, MAX_ARMS } from "@/lib/domain";
import { hostOf } from "@/lib/domain-normalize";
import { changeCount, changeLabel } from "@/lib/editor";
import { addArm } from "@/lib/validate-draft";
import { cn } from "@/lib/utils";

import type { SetupProps } from "./step-setup";
import { UrlCheckLine } from "./ui";

/**
 * The variants block of the Setup step (design v2 L456–496): one row per arm inside the Setup
 * card — Split URL rows with a URL each, or A/B rows with the arm's changes and the visual
 * editor — then a dashed "+ Add Variant X".
 */

function addLabel(n: number): string {
  return "+ Add " + (ARM_NAMES[n] ?? "variant");
}

function AddArmButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 cursor-pointer self-start rounded-md border border-dashed border-[#B9C6EE] bg-white px-3.5 text-[13px] font-extrabold text-brand hover:bg-brand-tint"
    >
      {label}
    </button>
  );
}

function RemoveButton({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      onClick={onClick}
      className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-bold text-danger-text"
    >
      Remove
    </button>
  );
}

/** "■ {Arm} URL" on the left, "{w}% of traffic" (and Remove) on the right. */
function ArmHeader({
  position,
  label,
  weight,
  onRemove,
  name,
}: {
  position: number;
  label: ReactNode;
  weight: number;
  onRemove?: () => void;
  name: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex flex-wrap items-center gap-2 text-[13px] font-extrabold">
        <ArmSwatch position={position} size={8} />
        {label}
      </span>
      <div className="flex items-center gap-3">
        <span className="text-[12.5px] text-ink-3">{weight}% of traffic</span>
        {onRemove ? <RemoveButton onClick={onRemove} name={name} /> : null}
      </div>
    </div>
  );
}

/** The read-only box beside an A/B arm's button (the page URL, or the arm's changes). */
const BOX =
  "flex min-h-[42px] min-w-0 flex-[1_1_260px] rounded-md border bg-[#FAFBFC] px-3 py-[9px]";

export function SplitVariantRows({
  draft,
  update,
  err,
  urlCheck,
  onCheckUrl,
  onRemoveArm,
}: SetupProps) {
  const ctrlHost = hostOf(draft.url.trim());
  const canRemove = draft.arms.length > 2;
  return (
    <>
      {draft.arms.slice(1).map((a, j) => {
        const i = j + 1;
        const e = err("variants", "v" + i);
        const h = hostOf(a.url.trim());
        const cross = !!h && !!ctrlHost && h !== ctrlHost && !e;
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <ArmHeader
              position={i}
              name={a.name}
              label={<>{a.name} URL</>}
              weight={a.weight}
              onRemove={canRemove ? () => onRemoveArm(i) : undefined}
            />
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
                Different domain from control. Make sure the Routely script is installed on {h} so
                conversions are attributed.
              </span>
            ) : null}
          </div>
        );
      })}
      {draft.arms.length < MAX_ARMS ? (
        <AddArmButton onClick={() => update(addArm)} label={addLabel(draft.arms.length)} />
      ) : null}
    </>
  );
}

export function AbVariantRows({
  draft,
  update,
  err,
  onRemoveArm,
  onOpenEditor,
  installed,
}: SetupProps) {
  const pageHost = hostOf(draft.url.trim()) || "your site";
  const canRemove = draft.arms.length > 2;
  return (
    <>
      {draft.arms.map((a, i) => {
        if (i === 0) {
          return (
            <div key={i} className="flex flex-col gap-1.5">
              <ArmHeader position={0} name={a.name} label="Control URL" weight={a.weight} />
              <div className="flex flex-wrap items-stretch gap-2">
                <div
                  className={cn(
                    BOX,
                    "items-center border-border font-mono text-[13px] break-all text-ink-2",
                  )}
                >
                  {draft.url.trim() || "Same as Page URL"}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenEditor(0)}
                  className="h-[42px] shrink-0 cursor-pointer rounded-md border border-input bg-white px-4 text-[13px] font-bold hover:border-navy"
                >
                  View original
                </button>
              </div>
              <span className="text-[12.5px] text-ink-3">Your live page, unchanged.</span>
            </div>
          );
        }
        const n = a.changes.length;
        const e = err("variants", "v" + i);
        const req = i === 1;
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <ArmHeader
              position={i}
              name={a.name}
              weight={a.weight}
              onRemove={canRemove ? () => onRemoveArm(i) : undefined}
              label={
                <>
                  {a.name}
                  <span
                    className={cn(
                      "rounded-sm px-[7px] py-0.5 text-[11px] font-bold",
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
                </>
              }
            />
            <div className="flex flex-wrap items-stretch gap-2">
              <div
                className={cn(
                  BOX,
                  "flex-col justify-center gap-[5px] transition-[border-color]",
                  e ? "border-[#E59A8A]" : n ? "border-border" : "border-input",
                )}
              >
                {n ? (
                  a.changes.map((c, k) => (
                    <div key={k} className="flex min-w-0 items-baseline gap-2.5 text-[13px]">
                      <span className="shrink-0 text-[11px] font-black text-success-text">✓</span>
                      <span className="shrink-0 font-bold text-ink-2">{changeLabel(c)}</span>
                      <span className="min-w-0 truncate text-foreground">“{c.value}”</span>
                    </div>
                  ))
                ) : (
                  <span className="text-[13px] text-ink-3">
                    No changes yet. Identical to Control.
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenEditor(i)}
                className={cn(
                  "min-h-[42px] shrink-0 cursor-pointer rounded-md border px-4 text-[13px] font-extrabold whitespace-nowrap",
                  n
                    ? "border-input bg-white text-foreground hover:border-brand hover:text-brand"
                    : "border-brand bg-brand text-white hover:bg-brand-hover",
                )}
              >
                {n ? "Edit changes" : "Open visual editor →"}
              </button>
            </div>
            {e ? (
              <span role="alert" className="text-[12.5px] font-semibold text-danger-text">
                {n
                  ? e
                  : `${a.name} needs at least one change. ${
                      req
                        ? "Open the visual editor to make an edit, then continue."
                        : "Open the visual editor to make an edit, or remove this variant."
                    }`}
              </span>
            ) : null}
            {!n && !installed ? (
              <span className="text-[12.5px] font-semibold text-warning-text">
                The visual editor needs the Routely snippet on {pageHost}. You’ll be guided through
                installing it.
              </span>
            ) : null}
          </div>
        );
      })}
      {draft.arms.length < MAX_ARMS ? (
        <AddArmButton onClick={() => update(addArm)} label={addLabel(draft.arms.length)} />
      ) : null}
    </>
  );
}
