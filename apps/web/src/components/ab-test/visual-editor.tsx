"use client";

import type { CSSProperties, ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { ArrowLeftIcon, PlusIcon, TrashIcon, XIcon } from "@/components/rt/icons";
import {
  ACCENT,
  ACCENT_INK,
  ACCENT_TINT,
  ARM_COLORS,
  BUTTON_COLORS,
  DEVICE_FRAMES,
  EL_ORDER,
  ELEMENTS,
  IMAGES,
  PRODUCTS,
  colorOf,
  describe,
  shortUrl,
  type AbState,
  type Device,
  type ElementChange,
  type ElementId,
  type VeState,
} from "@/lib/mock/ab-test";
import { cn } from "@/lib/utils";

import { DesktopIcon, ImageIcon, LockIcon, MobileIcon, TabletIcon, UndoIcon } from "./icons";
import { cls } from "./ui";

/** A version tab: the Control or a variant. */
export interface EditorTab {
  id: string;
  label: string;
  color: string;
}

/** The editor chrome both canvases share: the design's top bar and the two-pane body. */
export interface EditorShellProps {
  /** "Original page" or the variant's name. */
  title: string;
  /** Spoken dialog title, e.g. "Visual editor, original page". */
  srTitle: string;
  pill: "Editing" | "Read-only" | "Preview";
  tabs: EditorTab[];
  activeTab: string;
  onTab(id: string): void;
  /** "+ Add variant" after the tabs; absent when the actor cannot add one (or at the limit). */
  onAddTab?: () => void;
  /** A "×" on every tab but Control; absent when the actor cannot remove (or one variant is left). */
  onRemoveTab?: (id: string) => void;
  device: Device;
  onDevice(device: Device): void;
  /** Shows the save status, Undo and "Save changes". */
  editable: boolean;
  status: string;
  dirty: boolean;
  canUndo: boolean;
  onUndo(): void;
  onSave(): void;
  onExit(): void;
  /** The page column (its own scroll container). */
  canvas: ReactNode;
  /** The right-hand panel's content. */
  panel: ReactNode;
}

export interface EditorAct {
  pick(id: ElementId): void;
  deselect(): void;
  setDevice(device: Device): void;
  setDraft(id: ElementId, key: keyof ElementChange, value: string): void;
  removeDraft(id: ElementId): void;
  undo(): void;
  switchTo(target: string): void;
  save(): void;
  exit(): void;
}

const SANS = "'Geist', system-ui, sans-serif";

/**
 * The full-screen visual editor over the design's mock storefront — **only** for the design's
 * `?view=` comparison states, which never save anything. A real draft opens the live editor
 * (`live-editor/live-visual-editor.tsx`) on the customer's own page instead.
 *
 * A variant is editable while the experiment is a draft; the Control (and every version once live)
 * opens read-only. Edits go to a draft with undo history and reach the variant only on "Save
 * changes".
 */
export function VisualEditor({ s, ve, act }: { s: AbState; ve: VeState; act: EditorAct }) {
  const f = s.form;
  const lockAll = s.phase !== "edit";
  const tvar = f.variants.find((x) => x.id === ve.target) ?? null;
  const isControl = !tvar;
  const editable = !isControl && !lockAll;
  const overrides = isControl ? {} : editable ? ve.draft || {} : tvar.changes || {};
  const dirty = editable && JSON.stringify(ve.draft || {}) !== JSON.stringify(ve.saved || {});
  const D = DEVICE_FRAMES[ve.device] || DEVICE_FRAMES.desktop;

  const el = (id: ElementId) => {
    const val = { ...ELEMENTS[id], ...(overrides[id] || {}) };
    const selected = editable && ve.selected === id;
    const im = IMAGES[val.img ?? "trail"] || IMAGES.trail;
    return { ...val, selected, im, outline: selected ? "2px solid " + ACCENT : "none" };
  };
  const selId = editable && ve.selected && ELEMENTS[ve.selected] ? ve.selected : null;
  const selVal = selId ? { ...ELEMENTS[selId], ...(overrides[selId] || {}) } : null;
  const changeIds = EL_ORDER.filter((id) => overrides[id]);

  const title = isControl ? "Original page" : tvar.name;
  const status = dirty
    ? "Unsaved changes"
    : Object.keys(ve.saved || {}).length
      ? "All changes saved"
      : "No changes yet";

  const tabs = editorTabs(f.variants);

  // Hover outlines only while editing (`.rt-ve-on .rt-ve-el:hover`); locked elements are inert.
  const elCls = cn(
    "relative m-0 border-0 p-0 disabled:cursor-default disabled:opacity-100 focus-visible:!outline-2 focus-visible:!outline-offset-4 focus-visible:!outline-solid focus-visible:!outline-[#0091FF]",
    editable &&
      "cursor-pointer hover:!outline-2 hover:!outline-offset-4 hover:!outline-dashed hover:!outline-[#0091FF]",
  );
  const tag = (label: string, top = -26) => (
    <span
      aria-hidden
      className="absolute left-[-4px] rounded px-1.5 py-0.5 text-[11px] leading-4 font-semibold text-white"
      style={{ top, background: ACCENT, fontFamily: SANS }}
    >
      {label}
    </span>
  );
  const banner = el("banner");
  const h1 = el("h1");
  const sub = el("sub");
  const cta = el("cta");
  const img = el("img");
  const h2 = el("h2");

  return (
    <EditorShell
      title={title}
      srTitle={"Visual editor, " + (isControl ? "original page" : tvar.name)}
      pill={isControl ? "Read-only" : lockAll ? "Preview" : "Editing"}
      tabs={tabs}
      activeTab={isControl ? "control" : ve.target}
      onTab={act.switchTo}
      device={ve.device}
      onDevice={act.setDevice}
      editable={editable}
      status={status}
      dirty={dirty}
      canUndo={!!(ve.history || []).length}
      onUndo={act.undo}
      onSave={act.save}
      onExit={act.exit}
      canvas={
        <div className="min-w-0 flex-auto overflow-auto p-6 max-[901px]:flex-none max-[901px]:overflow-visible max-[641px]:p-3">
          {!editable ? (
            <div
              className="mx-auto mb-3 flex items-center gap-2.5 rounded-lg bg-white px-3 py-2.5 text-[13px] leading-[19px] text-[#374151]"
              style={{ maxWidth: D.max }}
            >
              <LockIcon size={16} className="flex-none" />
              <span>
                {isControl
                  ? "You’re viewing the original page. Routely never changes it — edits only apply to variants."
                  : "Preview of " + tvar.name + ". Editing is locked while the experiment is live."}
              </span>
            </div>
          ) : null}
          <div
            className="mx-auto overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_#1118271F]"
            style={{ maxWidth: D.max }}
          >
            <div
              aria-hidden
              className="flex h-[38px] items-center gap-2.5 border-b border-[#E5E7EB] bg-[#F3F4F6] px-3"
            >
              <span className="inline-flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[#D1D5DB]" />
                <span className="size-2.5 rounded-full bg-[#D1D5DB]" />
                <span className="size-2.5 rounded-full bg-[#D1D5DB]" />
              </span>
              <span className="h-6 min-w-0 flex-auto truncate rounded-md bg-white px-2.5 text-[12px] leading-6 text-[#6B7280]">
                {shortUrl(f.pageUrl) || "fernwoodsupply.com"}
              </span>
            </div>
            <div
              className="bg-[#FBF8F3] text-[#1E2A22]"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              <button
                type="button"
                onClick={() => editable && act.pick("banner")}
                disabled={!editable}
                aria-label={"Announcement bar: " + banner.text}
                className={cn(
                  elCls,
                  "block w-full rounded-none bg-[#1F3D2B] px-3 py-2 text-center text-[13px] text-white",
                )}
                style={{ fontFamily: SANS, outline: banner.outline, outlineOffset: -3 }}
              >
                {banner.text}
              </button>
              <div
                className="flex items-center justify-between gap-3 border-b border-[#ECE4D6] py-3.5"
                style={{ paddingLeft: D.pad, paddingRight: D.pad, fontFamily: SANS }}
              >
                <span
                  className="text-[18px] font-bold tracking-[-0.01em] text-[#1F3D2B]"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  Fernwood Supply
                </span>
                {D.nav ? (
                  <span className="flex gap-5 text-[13px] text-[#4A5A4E]">
                    <span>Shop</span>
                    <span>Journal</span>
                    <span>About</span>
                  </span>
                ) : null}
                <span className="text-[13px] text-[#4A5A4E]">Cart (0)</span>
              </div>
              <div
                className="flex items-stretch gap-7"
                style={{ flexDirection: D.dir, padding: D.pad }}
              >
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-4">
                  <button
                    type="button"
                    onClick={() => editable && act.pick("h1")}
                    disabled={!editable}
                    aria-label={"Heading: " + h1.text}
                    className={cn(
                      elCls,
                      "block rounded bg-transparent text-left leading-[1.12] font-bold tracking-[-0.01em] text-[#1E2A22]",
                    )}
                    style={{
                      fontFamily: "Georgia, serif",
                      fontSize: D.h1,
                      outline: h1.outline,
                      outlineOffset: 4,
                    }}
                  >
                    {h1.selected ? tag("Heading") : null}
                    {h1.text}
                  </button>
                  <button
                    type="button"
                    onClick={() => editable && act.pick("sub")}
                    disabled={!editable}
                    aria-label={"Text: " + sub.text}
                    className={cn(
                      elCls,
                      "block rounded bg-transparent text-left text-[16px] leading-[1.55] text-[#4A5A4E]",
                    )}
                    style={{ fontFamily: SANS, outline: sub.outline, outlineOffset: 4 }}
                  >
                    {sub.selected ? tag("Text") : null}
                    {sub.text}
                  </button>
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => editable && act.pick("cta")}
                      disabled={!editable}
                      aria-label={"Button: " + cta.text}
                      className={cn(elCls, "inline-flex rounded-lg bg-transparent")}
                      style={{ outline: cta.outline, outlineOffset: 4 }}
                    >
                      {cta.selected ? tag("Button", -28) : null}
                      <span
                        className="inline-flex h-[46px] items-center rounded-lg px-[22px] text-[15px] font-semibold text-white"
                        style={{ background: cta.bg, fontFamily: SANS }}
                      >
                        {cta.text}
                      </span>
                    </button>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => editable && act.pick("img")}
                    disabled={!editable}
                    aria-label={"Image: " + img.alt}
                    className={cn(
                      elCls,
                      "flex w-full flex-col items-center justify-center gap-2 rounded-[10px]",
                    )}
                    style={{
                      height: D.imgH,
                      background: img.im.bg,
                      color: img.im.ink,
                      outline: img.outline,
                      outlineOffset: 4,
                    }}
                  >
                    {img.selected ? tag("Image") : null}
                    <ImageIcon />
                    <span className="text-[13px] font-semibold" style={{ fontFamily: SANS }}>
                      {img.im.label}
                    </span>
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-4" style={{ padding: `8px ${D.pad} ${D.pad}` }}>
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => editable && act.pick("h2")}
                    disabled={!editable}
                    aria-label={"Heading: " + h2.text}
                    className={cn(
                      elCls,
                      "block rounded bg-transparent text-left text-[24px] leading-[1.2] font-bold text-[#1E2A22]",
                    )}
                    style={{
                      fontFamily: "Georgia, serif",
                      outline: h2.outline,
                      outlineOffset: 4,
                    }}
                  >
                    {h2.selected ? tag("Heading") : null}
                    {h2.text}
                  </button>
                </div>
                <div className="grid gap-4" style={{ gridTemplateColumns: D.grid }}>
                  {PRODUCTS.map((pd) => (
                    <div key={pd.name} className="flex flex-col gap-2" style={{ fontFamily: SANS }}>
                      <div
                        aria-hidden
                        className="h-[120px] rounded-lg"
                        style={{ background: pd.bg }}
                      />
                      <span className="text-[14px] font-semibold text-[#1E2A22]">{pd.name}</span>
                      <span className="text-[13px] text-[#4A5A4E]">{pd.price}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      }
      panel={
        <>
          {selId && selVal ? (
            <ElementPanel id={selId} val={selVal} canReset={!!overrides[selId]} act={act} />
          ) : (
            <div className="flex flex-col gap-2.5 border-b border-[#EEF0F3] p-[18px]">
              <span className="text-[15px] font-semibold text-[#111827]">
                {isControl
                  ? "Original page"
                  : lockAll
                    ? tvar.name + " preview"
                    : "Select an element to edit"}
              </span>
              <span className="text-[13px] leading-[19px] text-pretty text-[#4B5563]">
                {isControl
                  ? "This is the live page. Use the version switcher above to open a variant and make changes there."
                  : lockAll
                    ? "This is what visitors in " +
                      tvar.name +
                      " see. The experiment is live, so editing is locked."
                    : "Hover over the page and click a heading, text, button or image. Your edits only apply to " +
                      tvar.name +
                      "."}
              </span>
              {editable ? (
                <div className="flex flex-wrap gap-1.5">
                  {["Headings", "Text", "Buttons", "Images"].map((t) => (
                    <span
                      key={t}
                      className="inline-flex h-6 items-center rounded-md bg-[#F3F4F6] px-2 text-[12px] font-semibold text-[#374151]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <div className="flex flex-col gap-2.5 p-[18px]">
            <span className={cls.eyebrow}>
              {isControl ? "Changes" : "Changes in " + tvar.name + " (" + changeIds.length + ")"}
            </span>
            {changeIds.length === 0 ? (
              <span className="text-[13px] leading-[19px] text-[#6B7280]">
                {isControl
                  ? "The Control has no changes, and it never will."
                  : "No changes yet. Edit at least one element, then save."}
              </span>
            ) : null}
            {changeIds.map((id) => {
              const dd = describe(id, overrides[id]!);
              return (
                <div
                  key={id}
                  className="flex items-start gap-2.5 rounded-lg border border-[#EEF0F3] px-3 py-2.5"
                >
                  <span className="flex min-w-0 flex-auto flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-[#374151]">{dd.label}</span>
                    <span className="text-[13px] leading-[18px] [overflow-wrap:anywhere] text-[#4B5563]">
                      {dd.detail}
                    </span>
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => act.removeDraft(id)}
                      aria-label={"Remove change to " + dd.label}
                      className={cn(cls.ghost, "size-[30px] flex-none text-[#4B5563]")}
                    >
                      <TrashIcon size={15} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      }
    />
  );
}

const DEVICES: [Device, string, typeof DesktopIcon][] = [
  ["desktop", "Desktop", DesktopIcon],
  ["tablet", "Tablet", TabletIcon],
  ["mobile", "Mobile", MobileIcon],
];

const pressed = (on: boolean): CSSProperties => ({
  background: on ? "#FFFFFF" : "transparent",
  color: on ? "#111827" : "#4B5563",
  boxShadow: on ? "0 1px 2px #11182714" : "none",
});

/** The Control, then each variant, as version tabs. */
export function editorTabs(
  variants: readonly { id: string; name: string; color: number }[],
): EditorTab[] {
  return [{ id: "control", label: "Control", color: ARM_COLORS[0]! }].concat(
    variants.map((v) => ({ id: v.id, label: v.name, color: colorOf(v) })),
  );
}

/**
 * The full-screen editor's chrome: Exit, title and mode pill, version tabs, device toggle, save
 * status, Undo and "Save changes" over a page column and a 340px panel. Shared by the design's
 * mock canvas and the live editor, so both are the design's markup.
 */
export function EditorShell({
  title,
  srTitle,
  pill,
  tabs,
  activeTab,
  onTab,
  onAddTab,
  onRemoveTab,
  device,
  onDevice,
  editable,
  status,
  dirty,
  canUndo,
  onUndo,
  onSave,
  onExit,
  canvas,
  panel,
}: EditorShellProps) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onExit())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[85] flex flex-col bg-[#EEF0F3] text-[14px] leading-[1.45] text-[#111827] outline-none"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">{srTitle}</DialogPrimitive.Title>
          <div className="flex min-h-[60px] flex-none flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-[#E5E7EB] bg-white px-4 py-2.5">
            <button
              type="button"
              onClick={onExit}
              className={cn(cls.secondary, "gap-1.5 px-3", cls.tall)}
            >
              <ArrowLeftIcon />
              Exit
            </button>
            <div className="flex min-w-0 flex-col">
              <span className="text-[12px] leading-4 text-[#6B7280] max-[641px]:hidden">
                Visual editor
              </span>
              <span className="inline-flex items-center gap-2 text-[14px] leading-5 font-semibold text-[#111827]">
                {title}
                <span
                  className="inline-flex h-6 items-center rounded-md px-2 text-[12px] font-semibold"
                  style={{
                    background: pill === "Editing" ? ACCENT_TINT : "#F3F4F6",
                    color: pill === "Editing" ? ACCENT_INK : "#4B5563",
                  }}
                >
                  {pill}
                </span>
              </span>
            </div>
            <div
              role="group"
              aria-label="Version"
              className="flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-[#F1F3F5] p-[3px]"
            >
              {tabs.map((tb) => {
                const on = tb.id === activeTab;
                const removable = onRemoveTab && tb.id !== "control";
                return (
                  <span
                    key={tb.id}
                    className="inline-flex h-8 items-center rounded-lg"
                    style={pressed(on)}
                  >
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onTab(tb.id)}
                      className={cn(
                        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent pl-3 text-[13px] font-medium whitespace-nowrap text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
                        removable ? "pr-1" : "pr-3",
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-2 rounded-xs"
                        style={{ background: tb.color }}
                      />
                      {tb.label}
                    </button>
                    {removable ? (
                      <button
                        type="button"
                        aria-label={"Remove " + tb.label}
                        title={"Remove " + tb.label}
                        onClick={() => onRemoveTab(tb.id)}
                        className="mr-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-[#9CA3AF] hover:bg-[#E5E7EB] hover:text-[#B91C1C] focus-visible:outline-2 focus-visible:outline-[#0091FF]"
                      >
                        <XIcon size={12} />
                      </button>
                    ) : null}
                  </span>
                );
              })}
              {onAddTab ? (
                <button
                  type="button"
                  onClick={onAddTab}
                  className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-2.5 text-[13px] font-medium whitespace-nowrap text-[#0060AD] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
                >
                  <PlusIcon size={14} />
                  Add variant
                </button>
              ) : null}
            </div>
            <div
              role="group"
              aria-label="Device preview"
              className="flex gap-0.5 rounded-lg bg-[#F1F3F5] p-[3px]"
            >
              {DEVICES.map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={k === device}
                  aria-label={label + " preview"}
                  onClick={() => onDevice(k)}
                  className="inline-flex h-8 w-[38px] cursor-pointer items-center justify-center rounded-lg border-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
                  style={pressed(k === device)}
                >
                  <Icon size={17} strokeWidth={1.8} />
                </button>
              ))}
            </div>
            <div className="flex-auto" />
            {editable ? (
              <>
                <span
                  aria-live="polite"
                  className="text-[13px] whitespace-nowrap max-[641px]:hidden"
                  style={{ color: dirty ? "#92400E" : "#6B7280" }}
                >
                  {status}
                </span>
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={!canUndo}
                  aria-label="Undo"
                  className={cn(cls.ghost, "size-9 text-[#374151]")}
                >
                  <UndoIcon />
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={!dirty}
                  className={cn(cls.primary, "gap-1.5 px-3.5", cls.tall)}
                >
                  Save changes
                </button>
              </>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-auto max-[901px]:flex-col max-[901px]:overflow-y-auto">
            {canvas}
            <aside
              aria-label="Editor panel"
              className="flex w-[340px] flex-[0_0_340px] flex-col overflow-y-auto border-l border-[#E5E7EB] bg-white max-[901px]:w-auto max-[901px]:flex-none max-[901px]:overflow-visible max-[901px]:border-t max-[901px]:border-l-0"
            >
              {panel}
            </aside>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function PanelBlock({ gap, children }: { gap: number; children: ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {children}
    </div>
  );
}

function ElementPanel({
  id,
  val,
  canReset,
  act,
}: {
  id: ElementId;
  val: (typeof ELEMENTS)[ElementId];
  canReset: boolean;
  act: EditorAct;
}) {
  const def = ELEMENTS[id];
  const isButton = def.typeLabel === "Button";
  const isImage = def.typeLabel === "Image";
  return (
    <div className="flex flex-col gap-3.5 border-b border-[#EEF0F3] p-[18px]">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] text-[#6B7280]">{def.typeLabel}</span>
          <span className="text-[15px] font-semibold text-[#111827]">{def.label}</span>
        </div>
        <button
          type="button"
          onClick={act.deselect}
          aria-label="Close element settings"
          className={cn(cls.ghost, "size-8 text-[#4B5563]")}
        >
          <XIcon size={16} />
        </button>
      </div>
      {val.text != null ? (
        <PanelBlock gap={6}>
          <label htmlFor="rt-ve-text" className="text-[13px] font-medium text-[#374151]">
            {isButton ? "Button text" : "Text"}
          </label>
          <textarea
            id="rt-ve-text"
            rows={3}
            value={val.text}
            onChange={(e) => act.setDraft(id, "text", e.target.value)}
            className={cn(cls.input, "resize-y px-3 py-2.5 leading-5")}
          />
          <span className="text-[12px] text-[#6B7280]">Original: {def.text ?? ""}</span>
        </PanelBlock>
      ) : null}
      {isButton ? (
        <PanelBlock gap={8}>
          <span className="text-[13px] font-semibold text-[#374151]">Button color</span>
          <div role="group" aria-label="Button color" className="flex flex-wrap gap-2">
            {BUTTON_COLORS.map(([color, label]) => {
              const on = val.bg === color;
              return (
                <button
                  key={color}
                  type="button"
                  aria-pressed={on}
                  aria-label={label}
                  onClick={() => act.setDraft(id, "bg", color)}
                  className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-lg border-[1.5px] bg-white pr-2.5 pl-1.5 text-[13px] font-medium text-[#374151] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
                  style={{ borderColor: on ? ACCENT : "#E5E7EB" }}
                >
                  <span aria-hidden className="size-5 rounded-md" style={{ background: color }} />
                  {label}
                </button>
              );
            })}
          </div>
        </PanelBlock>
      ) : null}
      {isImage ? (
        <>
          <PanelBlock gap={8}>
            <span className="text-[13px] font-semibold text-[#374151]">Image</span>
            <div role="group" aria-label="Choose image" className="grid grid-cols-3 gap-2">
              {(Object.keys(IMAGES) as (keyof typeof IMAGES)[]).map((k) => {
                const on = val.img === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => act.setDraft(id, "img", k)}
                    className="flex cursor-pointer flex-col gap-1 rounded-lg border-2 bg-white p-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
                    style={{ borderColor: on ? ACCENT : "#E5E7EB" }}
                  >
                    <span
                      aria-hidden
                      className="block h-[52px] rounded-md"
                      style={{ background: IMAGES[k].bg }}
                    />
                    <span className="px-0.5 text-[12px] font-medium text-[#374151]">
                      {IMAGES[k].label}
                    </span>
                  </button>
                );
              })}
            </div>
          </PanelBlock>
          <PanelBlock gap={6}>
            <label htmlFor="rt-ve-alt" className="text-[13px] font-medium text-[#374151]">
              Alt text
            </label>
            <input
              id="rt-ve-alt"
              type="text"
              value={val.alt ?? ""}
              onChange={(e) => act.setDraft(id, "alt", e.target.value)}
              className={cn(cls.input, "h-10 px-3")}
            />
          </PanelBlock>
        </>
      ) : null}
      {canReset ? (
        <button
          type="button"
          onClick={() => act.removeDraft(id)}
          className={cn(cls.quiet, "-ml-1 h-8 gap-1.5 self-start px-1 text-[#4B5563]")}
        >
          <UndoIcon size={14} strokeWidth={2} />
          Reset to original
        </button>
      ) : null}
    </div>
  );
}
