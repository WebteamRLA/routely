"use client";

import { useId, useState } from "react";

import type { ElementDescriptor } from "@routely/sdk/contract";

import { XIcon } from "@/components/rt/icons";
import {
  EDITOR_MAX_ALT,
  EDITOR_MAX_TEXT,
  type EditKey,
  isEditorImageUrl,
  kindLabel,
  toHexColor,
} from "@/lib/editor-protocol";
import { ACCENT } from "@/lib/mock/ab-test";
import { cn } from "@/lib/utils";
import type { VisualChange } from "@/validation/visual-change";

import { FieldError, cls } from "../ui";
import { UndoIcon } from "../icons";
import { PanelBlock } from "../visual-editor";

/**
 * The selected element's settings — the design's panel (§4.1) for an element of the real page:
 * text for headings, text and buttons; a button's background colour; an image's URL and alt text;
 * "Reset to original". Every value is checked here the way the server will check it, so an edit
 * that would not save is never made.
 *
 * The design's preset swatches and images were mock content (spec §4.4): colours come from the
 * element itself and from buttons seen on the page, plus a colour picker; an image is a URL.
 */
export function LiveElementPanel({
  el,
  change,
  swatches,
  error,
  onEdit,
  onReset,
  onClose,
}: {
  el: ElementDescriptor;
  /** The element's change in the draft, if any. */
  change: VisualChange | undefined;
  /** Colours sampled from buttons on the page, besides this element's own. */
  swatches: readonly string[];
  /** Why the last edit was refused (the 50-change cap). */
  error: string | null;
  onEdit(key: EditKey, value: string | undefined): void;
  onReset(): void;
  onClose(): void;
}) {
  const ids = useId();
  const isButton = el.kind === "button";
  const isImage = el.kind === "image";
  const set = change?.set ?? {};

  const text = set.text ?? el.current.text ?? "";
  const originalColor = el.current.backgroundColor;
  const color = set.backgroundColor ?? originalColor;
  const colorHex = toHexColor(color) ?? "#000000";
  const palette = [
    ...(toHexColor(originalColor) ? [{ value: originalColor as string, label: "Original" }] : []),
    ...swatches
      .filter((sw) => toHexColor(sw) !== toHexColor(originalColor))
      .map((sw) => ({ value: sw, label: toHexColor(sw) ?? sw })),
  ];

  // What is being typed while it is not a usable URL yet; null shows the stored value, so undo and
  // reset are reflected without syncing state.
  const [typed, setTyped] = useState<string | null>(null);
  const src = typed ?? set.src ?? "";
  const srcBad = typed !== null;

  return (
    <div className="flex flex-col gap-3.5 border-b border-[#EEF0F3] p-[18px]">
      <div className="flex items-center justify-between gap-2.5">
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

      {!isImage ? (
        el.textEditable ? (
          <PanelBlock gap={6}>
            <label htmlFor={ids + "text"} className="text-[13px] font-medium text-[#374151]">
              {isButton ? "Button text" : "Text"}
            </label>
            <textarea
              id={ids + "text"}
              rows={3}
              maxLength={EDITOR_MAX_TEXT}
              value={text}
              onChange={(e) => onEdit("text", e.target.value)}
              className={cn(cls.input, "resize-y px-3 py-2.5 leading-5")}
            />
            <span className="text-[12px] [overflow-wrap:anywhere] text-[#6B7280]">
              Original: {el.current.text ?? ""}
            </span>
          </PanelBlock>
        ) : (
          <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
            This element holds more than text, so its text can’t be replaced without removing the
            rest.
          </p>
        )
      ) : null}

      {isButton ? (
        <PanelBlock gap={8}>
          <span className="text-[13px] font-semibold text-[#374151]">Button color</span>
          <div role="group" aria-label="Button color" className="flex flex-wrap gap-2">
            {palette.map((sw) => {
              const on = toHexColor(color) === toHexColor(sw.value);
              return (
                <button
                  key={sw.label + sw.value}
                  type="button"
                  aria-pressed={on}
                  aria-label={sw.label === "Original" ? "Original color" : sw.label}
                  onClick={() => onEdit("backgroundColor", sw.value)}
                  className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-lg border-[1.5px] bg-white pr-2.5 pl-1.5 text-[13px] font-medium text-[#374151] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
                  style={{ borderColor: on ? ACCENT : "#E5E7EB" }}
                >
                  <span
                    aria-hidden
                    className="size-5 rounded-md border border-[#11182714]"
                    style={{ background: sw.value }}
                  />
                  {sw.label}
                </button>
              );
            })}
            <label className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-lg border-[1.5px] border-[#E5E7EB] bg-white pr-2.5 pl-1.5 text-[13px] font-medium text-[#374151] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#0091FF]">
              <input
                type="color"
                value={colorHex}
                onChange={(e) => onEdit("backgroundColor", e.target.value)}
                aria-label="Custom color"
                className="size-5 cursor-pointer rounded-md border-0 bg-transparent p-0"
              />
              Custom
            </label>
          </div>
        </PanelBlock>
      ) : null}

      {isImage ? (
        <>
          <PanelBlock gap={6}>
            <label htmlFor={ids + "src"} className="text-[13px] font-medium text-[#374151]">
              Image URL
            </label>
            <input
              id={ids + "src"}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={src}
              aria-invalid={srcBad ? "true" : "false"}
              onChange={(e) => {
                const next = e.target.value;
                const trimmed = next.trim();
                if (trimmed === "" || isEditorImageUrl(trimmed)) {
                  setTyped(null);
                  onEdit("src", trimmed === "" ? undefined : trimmed);
                } else {
                  setTyped(next);
                }
              }}
              className={cn(cls.input, "h-10 px-3")}
            />
            {srcBad ? (
              <FieldError>Use an https:// image URL.</FieldError>
            ) : (
              <span className="text-[12px] [overflow-wrap:anywhere] text-[#6B7280]">
                {el.current.src
                  ? "Original: " + el.current.src
                  : "Leave empty to keep the original."}
              </span>
            )}
          </PanelBlock>
          <PanelBlock gap={6}>
            <label htmlFor={ids + "alt"} className="text-[13px] font-medium text-[#374151]">
              Alt text
            </label>
            <input
              id={ids + "alt"}
              type="text"
              maxLength={EDITOR_MAX_ALT}
              value={set.alt ?? el.current.alt ?? ""}
              onChange={(e) => onEdit("alt", e.target.value)}
              className={cn(cls.input, "h-10 px-3")}
            />
          </PanelBlock>
        </>
      ) : null}

      {error ? <FieldError alert>{error}</FieldError> : null}

      {change ? (
        <button
          type="button"
          onClick={() => {
            setTyped(null);
            onReset();
          }}
          className={cn(cls.quiet, "-ml-1 h-8 gap-1.5 self-start px-1 text-[#4B5563]")}
        >
          <UndoIcon size={14} strokeWidth={2} />
          Reset to original
        </button>
      ) : null}
    </div>
  );
}
