"use client";

import { useId, useState, type ReactNode } from "react";

import type { ElementDescriptor } from "@routely/sdk/contract";

import { ChevronDownIcon, XIcon } from "@/components/rt/icons";
import {
  EDITOR_MAX_ALT,
  EDITOR_MAX_TEXT,
  type EditKey,
  isEditorImageUrl,
  kindLabel,
  toHexColor,
} from "@/lib/editor-protocol";
import { ACCENT } from "@/lib/mock/ab-test";
import { FONT_WEIGHTS, TEXT_ALIGNS, isBoxValue, isFontSize } from "@/lib/style-values";
import { cn } from "@/lib/utils";
import type { VisualChange } from "@/validation/visual-change";

import { FieldError, cls } from "../ui";
import { UndoIcon } from "../icons";
import { PanelBlock } from "../visual-editor";

/**
 * The selected element's settings, laid out like WordPress's block inspector: a breadcrumb to climb
 * to the block around it, then collapsible sections — Content (text, or an image's URL and alt),
 * Color (text and background), Typography (size, weight, alignment), Dimensions (padding,
 * margin) and Visibility (hide in this variant). Every value is checked here the way the server
 * checks it (`lib/style-values.ts`), so an edit that would not save is never made.
 */

type EditValue = string | true | undefined;

const WEIGHT_NAMES: Record<string, string> = {
  "100": "Thin",
  "200": "Extra light",
  "300": "Light",
  "400": "Regular",
  "500": "Medium",
  "600": "Semibold",
  "700": "Bold",
  "800": "Extra bold",
  "900": "Black",
};

/** A collapsible inspector section, open by default — Gutenberg's panel body. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-t border-[#EEF0F3]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full cursor-pointer items-center justify-between border-0 bg-transparent px-[18px] text-[13px] font-semibold text-[#111827] hover:bg-[#FAFBFC] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0091FF]"
      >
        {title}
        <ChevronDownIcon
          size={16}
          className={cn("text-[#6B7280] transition-transform", open ? "rotate-180" : "")}
        />
      </button>
      {open ? <div className="flex flex-col gap-3.5 px-[18px] pb-4">{children}</div> : null}
    </section>
  );
}

const label = "text-[13px] font-medium text-[#374151]";
const hint = "text-[12px] [overflow-wrap:anywhere] text-[#6B7280]";

/**
 * A free-text style value (font size, padding, margin): what is typed is kept while it is not
 * valid yet, with the rule shown, and becomes an edit only once it is.
 */
function StyleText({
  id,
  title,
  value,
  original,
  placeholder,
  valid,
  rule,
  onEdit,
}: {
  id: string;
  title: string;
  value: string | undefined;
  original: string | undefined;
  placeholder: string;
  valid(value: string): boolean;
  rule: string;
  onEdit(value: string | undefined): void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? value ?? "";
  return (
    <PanelBlock gap={6}>
      <label htmlFor={id} className={label}>
        {title}
      </label>
      <input
        id={id}
        type="text"
        value={shown}
        placeholder={original || placeholder}
        aria-invalid={typed !== null ? "true" : "false"}
        onChange={(e) => {
          const next = e.target.value;
          const trimmed = next.trim().replace(/\s+/g, " ");
          if (trimmed === "") {
            setTyped(null);
            onEdit(undefined);
          } else if (valid(trimmed)) {
            setTyped(null);
            onEdit(trimmed);
          } else {
            setTyped(next);
          }
        }}
        className={cn(cls.input, "h-9 px-3")}
      />
      {typed !== null ? (
        <FieldError>{rule}</FieldError>
      ) : (
        <span className={hint}>{original ? "Original: " + original : rule}</span>
      )}
    </PanelBlock>
  );
}

/** A colour: the page's colours as swatches, a picker, and the value written out. */
function ColorField({
  title,
  value,
  original,
  swatches,
  onEdit,
}: {
  title: string;
  value: string | undefined;
  original: string | undefined;
  swatches: readonly string[];
  onEdit(value: string | undefined): void;
}) {
  const current = value ?? original;
  const palette = [
    ...(toHexColor(original) ? [{ value: original as string, name: "Original" }] : []),
    ...swatches
      .filter((sw) => toHexColor(sw) !== toHexColor(original))
      .map((sw) => ({ value: sw, name: toHexColor(sw) ?? sw })),
  ];
  return (
    <PanelBlock gap={8}>
      <div className="flex items-center justify-between gap-2">
        <span className={label}>{title}</span>
        {value !== undefined ? (
          <button
            type="button"
            onClick={() => onEdit(undefined)}
            className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-[#4B5563] underline hover:text-[#111827]"
          >
            Reset
          </button>
        ) : null}
      </div>
      <div role="group" aria-label={title} className="flex flex-wrap items-center gap-1.5">
        {palette.map((sw) => {
          const on = toHexColor(current) === toHexColor(sw.value);
          return (
            <button
              key={sw.name + sw.value}
              type="button"
              aria-pressed={on}
              aria-label={sw.name === "Original" ? "Original " + title.toLowerCase() : sw.name}
              title={sw.name}
              onClick={() => onEdit(sw.name === "Original" ? undefined : sw.value)}
              className="size-7 cursor-pointer rounded-full border-2 p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
              style={{ background: sw.value, borderColor: on ? ACCENT : "#E5E7EB" }}
            />
          );
        })}
        <label
          title="Custom colour"
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white pr-2.5 pl-1 text-[12px] font-medium text-[#374151] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#0091FF]"
        >
          <input
            type="color"
            value={toHexColor(current) ?? "#000000"}
            onChange={(e) => onEdit(e.target.value)}
            aria-label={"Custom " + title.toLowerCase()}
            className="size-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          {toHexColor(current) ?? "None"}
        </label>
      </div>
    </PanelBlock>
  );
}

export function LiveElementPanel({
  el,
  change,
  swatches,
  error,
  onEdit,
  onReset,
  onClose,
  onSelectParent,
}: {
  el: ElementDescriptor;
  /** The element's change in the draft, if any. */
  change: VisualChange | undefined;
  /** Colours seen on the page, besides this element's own. */
  swatches: readonly string[];
  /** Why the last edit was refused (the 50-change cap). */
  error: string | null;
  onEdit(key: EditKey, value: EditValue): void;
  onReset(): void;
  onClose(): void;
  /** Selects the `depth`-th block around this one (1 = its parent). */
  onSelectParent(depth: number): void;
}) {
  const ids = useId();
  const isButton = el.kind === "button";
  const isImage = el.kind === "image";
  const set = change?.set ?? {};
  const now = el.current;
  const crumbs = el.crumbs ?? [];

  const [typedSrc, setTypedSrc] = useState<string | null>(null);
  const src = typedSrc ?? set.src ?? "";

  const align = set.textAlign ?? (now.textAlign === "start" ? "left" : now.textAlign);
  const weight = set.fontWeight ?? now.fontWeight ?? "400";

  return (
    <div className="flex flex-col border-b border-[#EEF0F3]">
      <div className="flex flex-col gap-2 p-[18px] pb-3.5">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] text-[#6B7280]">{kindLabel(el.kind)}</span>
            <span className="text-[15px] font-semibold [overflow-wrap:anywhere] text-[#111827]">
              {el.label || kindLabel(el.kind)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close element settings"
            className={cn(cls.ghost, "size-8 flex-none text-[#4B5563]")}
          >
            <XIcon size={16} />
          </button>
        </div>
        {crumbs.length > 0 ? (
          <nav aria-label="Blocks around this one" className="flex flex-wrap items-center gap-1">
            {[...crumbs].reverse().map((crumb, i) => {
              const depth = crumbs.length - i;
              return (
                <span key={depth} className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelectParent(depth)}
                    title={"Select this " + crumb.toLowerCase()}
                    className="cursor-pointer rounded-md border-0 bg-[#F3F4F6] px-1.5 py-0.5 text-[12px] font-medium text-[#374151] hover:bg-[#E6F4FF] hover:text-[#0060AD] focus-visible:outline-2 focus-visible:outline-[#0091FF]"
                  >
                    {crumb}
                  </button>
                  <span aria-hidden className="text-[12px] text-[#9CA3AF]">
                    ›
                  </span>
                </span>
              );
            })}
            <span className="rounded-md bg-[#E6F4FF] px-1.5 py-0.5 text-[12px] font-semibold text-[#0060AD]">
              {el.kind === "block" ? el.label.split(" · ")[0] : kindLabel(el.kind)}
            </span>
          </nav>
        ) : null}
      </div>

      <Section title="Content">
        {isImage ? (
          <>
            <PanelBlock gap={6}>
              <label htmlFor={ids + "src"} className={label}>
                Image URL
              </label>
              <input
                id={ids + "src"}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={src}
                aria-invalid={typedSrc !== null ? "true" : "false"}
                onChange={(e) => {
                  const next = e.target.value;
                  const trimmed = next.trim();
                  if (trimmed === "" || isEditorImageUrl(trimmed)) {
                    setTypedSrc(null);
                    onEdit("src", trimmed === "" ? undefined : trimmed);
                  } else {
                    setTypedSrc(next);
                  }
                }}
                className={cn(cls.input, "h-10 px-3")}
              />
              {typedSrc !== null ? (
                <FieldError>Use an https:// image URL.</FieldError>
              ) : (
                <span className={hint}>
                  {now.src ? "Original: " + now.src : "Leave empty to keep the original."}
                </span>
              )}
            </PanelBlock>
            <PanelBlock gap={6}>
              <label htmlFor={ids + "alt"} className={label}>
                Alt text
              </label>
              <input
                id={ids + "alt"}
                type="text"
                maxLength={EDITOR_MAX_ALT}
                value={set.alt ?? now.alt ?? ""}
                onChange={(e) => onEdit("alt", e.target.value)}
                className={cn(cls.input, "h-10 px-3")}
              />
            </PanelBlock>
          </>
        ) : el.textEditable ? (
          <PanelBlock gap={6}>
            <label htmlFor={ids + "text"} className={label}>
              {isButton ? "Button text" : "Text"}
            </label>
            <textarea
              id={ids + "text"}
              rows={3}
              maxLength={EDITOR_MAX_TEXT}
              value={set.text ?? now.text ?? ""}
              onChange={(e) => onEdit("text", e.target.value)}
              className={cn(cls.input, "resize-y px-3 py-2.5 leading-5")}
            />
            <span className={hint}>Original: {now.text ?? ""}</span>
          </PanelBlock>
        ) : (
          <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
            {el.kind === "block"
              ? "To change words, select the text inside this block. Style the whole block below."
              : "This element holds more than text, so its text can’t be replaced without removing the rest."}
          </p>
        )}
      </Section>

      <Section title="Color">
        <ColorField
          title="Text"
          value={set.color}
          original={now.color}
          swatches={swatches}
          onEdit={(v) => onEdit("color", v)}
        />
        <ColorField
          title="Background"
          value={set.backgroundColor}
          original={now.backgroundColor}
          swatches={swatches}
          onEdit={(v) => onEdit("backgroundColor", v)}
        />
      </Section>

      <Section title="Typography">
        <StyleText
          id={ids + "size"}
          title="Font size"
          value={set.fontSize}
          original={now.fontSize}
          placeholder="16px"
          valid={isFontSize}
          rule="Use a size like 24px, 1.5rem or 120%."
          onEdit={(v) => onEdit("fontSize", v)}
        />
        <PanelBlock gap={6}>
          <label htmlFor={ids + "weight"} className={label}>
            Font weight
          </label>
          <select
            id={ids + "weight"}
            value={(FONT_WEIGHTS as readonly string[]).includes(weight) ? weight : "400"}
            onChange={(e) =>
              onEdit("fontWeight", e.target.value === now.fontWeight ? undefined : e.target.value)
            }
            className={cn(cls.input, "h-9 cursor-pointer px-2.5")}
          >
            {FONT_WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {WEIGHT_NAMES[w]} ({w})
              </option>
            ))}
          </select>
        </PanelBlock>
        <PanelBlock gap={6}>
          <span className={label}>Alignment</span>
          <div role="group" aria-label="Alignment" className="flex gap-1">
            {TEXT_ALIGNS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={align === a}
                onClick={() => onEdit("textAlign", set.textAlign === a ? undefined : a)}
                className="h-8 flex-1 cursor-pointer rounded-md border text-[12px] font-medium capitalize focus-visible:outline-2 focus-visible:outline-[#0091FF]"
                style={{
                  borderColor: align === a ? ACCENT : "#E5E7EB",
                  background: align === a ? "#E6F4FF" : "#FFFFFF",
                  color: align === a ? "#0060AD" : "#374151",
                }}
              >
                {a}
              </button>
            ))}
          </div>
        </PanelBlock>
      </Section>

      <Section title="Dimensions">
        <StyleText
          id={ids + "padding"}
          title="Padding"
          value={set.padding}
          original={now.padding}
          placeholder="16px 24px"
          valid={(v) => isBoxValue(v, false)}
          rule="One to four sizes (top right bottom left), like 16px or 16px 24px."
          onEdit={(v) => onEdit("padding", v)}
        />
        <StyleText
          id={ids + "margin"}
          title="Margin"
          value={set.margin}
          original={now.margin}
          placeholder="0 auto"
          valid={(v) => isBoxValue(v, true)}
          rule="One to four sizes or auto, like 0 auto."
          onEdit={(v) => onEdit("margin", v)}
        />
      </Section>

      <Section title="Visibility">
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[#374151]">
          <input
            type="checkbox"
            checked={set.hidden === true}
            onChange={(e) => onEdit("hidden", e.target.checked ? true : undefined)}
            className="mt-0.5 size-4 cursor-pointer accent-[#0070C9]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Hide in this variant</span>
            <span className={hint}>
              Visitors in this variant won’t see this {el.kind === "block" ? "block" : "element"}.
            </span>
          </span>
        </label>
      </Section>

      {error || change ? (
        <div className="flex flex-col gap-2 border-t border-[#EEF0F3] px-[18px] py-3.5">
          {error ? <FieldError alert>{error}</FieldError> : null}
          {change ? (
            <button
              type="button"
              onClick={() => {
                setTypedSrc(null);
                onReset();
              }}
              className={cn(cls.quiet, "-ml-1 h-8 gap-1.5 self-start px-1 text-[#4B5563]")}
            >
              <UndoIcon size={14} strokeWidth={2} />
              Reset everything to original
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
