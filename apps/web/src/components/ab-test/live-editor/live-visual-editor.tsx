"use client";

import { useEffect, useRef, useState } from "react";

import type { ElementDescriptor } from "@routely/sdk/contract";

import { TrashIcon } from "@/components/rt/icons";
import { describeChange } from "@/lib/change-summary";
import {
  EDITOR_MAX_CHANGES,
  type EditKey,
  changeFor,
  editChange,
  kindLabel,
  removeChange,
  toHexColor,
  toWireChanges,
} from "@/lib/editor-protocol";
import { isPlaceholderChange, shortUrl } from "@/lib/launch-rules";
import { DEVICE_FRAMES, type AbForm, type Device } from "@/lib/mock/ab-test";
import { cn } from "@/lib/utils";
import type { VisualChange } from "@/validation/visual-change";

import { ConfirmDialog } from "../dialog";
import { LockIcon } from "../icons";
import { cls } from "../ui";
import { EditorShell, editorTabs } from "../visual-editor";
import { ConnectionCard } from "./connection-card";
import { LiveElementPanel } from "./element-panel";
import { useEditorBridge } from "./use-editor-bridge";

/** Undo depth, as in the design. */
const HISTORY = 40;
/** Button colours remembered from the page, for the colour swatches. */
const MAX_SWATCHES = 6;

export interface LiveVisualEditorProps {
  form: AbForm;
  /** "control" or a variant id. */
  initialTarget: string;
  initialDevice: Device;
  /** The actor may change this draft (Editor or above, and still a DRAFT). */
  editable: boolean;
  /** A Viewer: the page is not opened; saved changes are listed read-only. */
  viewer: boolean;
  /** Flushes the autosave; resolves to the draft id, or null when it could not be saved. */
  ensureDraft(): Promise<string | null>;
  /**
   * The variant's whole change list, persisted by the draft autosave. "Save changes" leaves the
   * editor; `stay` is the save made on switching to another variant, which keeps it open.
   */
  onSave(variantId: string, changes: VisualChange[], options?: { stay?: boolean }): void;
  onExit(): void;
  /**
   * "+ Add variant" in the tab bar: adds one to the draft and returns its id (null at the limit).
   * Absent when the actor cannot add variants.
   */
  onAddVariant?: () => string | null;
  /**
   * "×" on a variant tab: removes it (confirming first when it has changes — `pending` is the open
   * variant's current list, unsaved edits included). Absent when the actor cannot remove variants.
   */
  onRemoveVariant?: (id: string, pending?: number) => void;
  /** Leaves the editor for the install instructions. */
  onInstall(): void;
}

const clone = (changes: readonly VisualChange[]): VisualChange[] =>
  JSON.parse(JSON.stringify(changes)) as VisualChange[];

/**
 * The visual editor on the customer's real page (spec §4, D4).
 *
 * The page is loaded in a frame — or a popup when the site forbids framing — and the Routely SDK
 * on it hands over to the editor agent (`use-editor-bridge.ts`). The agent outlines and reports
 * what the customer points at; this component turns a selected element into the design's panel,
 * keeps the edits as real `VisualChange`s with undo, previews them live on the page, and on "Save
 * changes" hands the list to the wizard, whose autosave stores it in the variant.
 *
 * Without a connection — no snippet, framing refused, the agent missing — the editor says so and
 * offers the fix, and the saved changes stay listed (and removable) in the panel.
 */
export function LiveVisualEditor({
  form,
  initialTarget,
  initialDevice,
  editable,
  viewer,
  ensureDraft,
  onSave,
  onExit,
  onAddVariant,
  onRemoveVariant,
  onInstall,
}: LiveVisualEditorProps) {
  const variantOf = (id: string) => form.variants.find((v) => v.id === id) ?? null;
  const startList = clone(variantOf(initialTarget)?.visual ?? []);

  const [target, setTarget] = useState(variantOf(initialTarget) ? initialTarget : "control");
  const [device, setDevice] = useState<Device>(initialDevice);
  const [draft, setDraft] = useState<VisualChange[]>(startList);
  const [saved, setSaved] = useState<VisualChange[]>(startList);
  const [history, setHistory] = useState<VisualChange[][]>([]);
  const [selected, setSelected] = useState<ElementDescriptor | null>(null);
  const [confirm, setConfirm] = useState<{ next: string | null } | null>(null);
  const [swatches, setSwatches] = useState<string[]>([]);
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const variant = variantOf(target);
  const isControl = !variant;
  const canEdit = editable && !viewer && !isControl;
  const shown: readonly VisualChange[] = isControl ? [] : canEdit ? draft : (variant.visual ?? []);
  const dirty = canEdit && JSON.stringify(draft) !== JSON.stringify(saved);
  const D = DEVICE_FRAMES[device];
  // Desktop fills the canvas, so the real page gets as much room as the screen allows; tablet and
  // mobile keep their device widths, which is what those previews are for.
  const frameMax = device === "desktop" ? undefined : D.max;

  // Read by the bridge's handlers, which outlive a render.
  const canEditRef = useRef(canEdit);
  const sentRef = useRef<string[]>([]);
  useEffect(() => {
    canEditRef.current = canEdit;
  });

  const remember = (color: string | undefined) => {
    if (!toHexColor(color)) return;
    setSwatches((list) =>
      list.some((c) => toHexColor(c) === toHexColor(color))
        ? list
        : [...list, color as string].slice(-MAX_SWATCHES),
    );
  };

  const {
    state: link,
    session,
    attempt,
    via,
    setFrame,
    onFrameLoad,
    openPopup,
    focusPopup,
    retry,
    send,
  } = useEditorBridge({
    enabled: !viewer,
    ensureDraft,
    handlers: {
      onHover: (el) => {
        if (el?.kind === "button") remember(el.current.backgroundColor);
      },
      onSelect: (el) => {
        if (!canEditRef.current) return;
        if (el.kind === "button") remember(el.current.backgroundColor);
        setError(null);
        setSelected(el);
      },
      onApplied: (results) => {
        const sent = sentRef.current;
        setApplied(Object.fromEntries(sent.map((selector, i) => [selector, results[i] !== false])));
      },
    },
  });
  const ready = link.kind === "ready";

  // The page shows exactly `shown`, in edit or preview mode, whenever either changes — and again
  // after every (re)connection, since a reloaded page starts from its original state.
  const wire = JSON.stringify(toWireChanges(shown));
  const mode = canEdit ? "edit" : "preview";
  useEffect(() => {
    if (!ready) return;
    const changes = JSON.parse(wire) as ReturnType<typeof toWireChanges>;
    sentRef.current = changes.map((change) => change.selector);
    send({ type: "routely:mode", mode });
    send({ type: "routely:preview", changes });
  }, [ready, wire, mode, send]);

  const selectedSelector = canEdit ? (selected?.selector ?? null) : null;
  useEffect(() => {
    if (ready) send({ type: "routely:highlight", selector: selectedSelector });
  }, [ready, selectedSelector, send]);

  const commit = (next: readonly VisualChange[]) => {
    if (next === draft) return;
    if (next.length > EDITOR_MAX_CHANGES) {
      setError(`A variant can have at most ${EDITOR_MAX_CHANGES} changed elements.`);
      return;
    }
    setError(null);
    setHistory((h) => [...h, draft].slice(-HISTORY));
    setDraft([...next]);
  };
  const edit = (key: EditKey, value: string | undefined) => {
    if (selected && canEdit) commit(editChange(draft, selected, key, value));
  };
  const revert = (selector: string) => {
    if (canEdit) commit(removeChange(draft, selector));
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setDraft(prev);
    setError(null);
  };
  const save = () => {
    if (!variant || !canEdit) return;
    onSave(variant.id, clone(draft));
    setSaved(clone(draft));
  };

  /** `isNew`: a variant just added, which the form holds by the next render (no changes yet). */
  const open = (next: string, isNew = false) => {
    const list = clone(variantOf(next)?.visual ?? []);
    setTarget(isNew || variantOf(next) ? next : "control");
    setDraft(list);
    setSaved(list);
    setHistory([]);
    setSelected(null);
    setError(null);
    setApplied({});
  };
  // Switching variants saves the one being left — no "discard?" question: an edit made and then
  // switched away from was meant to be kept. Only Exit still asks (below).
  const switchTo = (next: string) => {
    if (next === target) return;
    if (dirty && variant && canEdit) onSave(variant.id, clone(draft), { stay: true });
    open(next);
  };
  const exit = () => {
    if (dirty) setConfirm({ next: null });
    else onExit();
  };

  // "×" on a tab. The wizard removes it (after its confirm, when there are changes); if it was the
  // variant open here, the editor then moves to its neighbour — below, once it is gone.
  const [afterRemove, setAfterRemove] = useState("control");
  const removeVariant = (id: string) => {
    if (!onRemoveVariant) return;
    const ids = form.variants.map((v) => v.id);
    const at = ids.indexOf(id);
    if (id === target) setAfterRemove(ids[at - 1] ?? ids[at + 1] ?? "control");
    onRemoveVariant(id, id === target ? draft.length : undefined);
  };
  if (target !== "control" && !variant) {
    // The open variant no longer exists (removed above, or elsewhere).
    open(variantOf(afterRemove) ? afterRemove : "control");
  }

  // "+ Add variant": the variant being left is saved, as on any switch, then the new one opens.
  // The wizard's form update and this switch come from the same click, so they render together.
  const addVariant = () => {
    if (!onAddVariant) return;
    if (dirty && variant && canEdit) onSave(variant.id, clone(draft), { stay: true });
    const id = onAddVariant();
    if (id) open(id, true);
  };
  const discard = () => {
    const next = confirm?.next ?? null;
    setConfirm(null);
    if (next) open(next);
    else onExit();
  };

  const name = variant?.name ?? "Original page";
  const status = dirty ? "Unsaved changes" : saved.length ? "All changes saved" : "No changes yet";
  const pageUrl = session?.pageUrl ?? form.pageUrl;
  const actions = {
    retry: () => void retry(),
    openPopup,
    focusPopup,
    install: onInstall,
  };
  const selectedChange = selected ? changeFor(draft, selected.selector) : undefined;

  return (
    <>
      <EditorShell
        title={name}
        srTitle={"Visual editor, " + (isControl ? "original page" : name)}
        pill={isControl ? "Read-only" : canEdit ? "Editing" : "Preview"}
        tabs={editorTabs(form.variants)}
        activeTab={isControl ? "control" : target}
        onTab={switchTo}
        onAddTab={onAddVariant ? addVariant : undefined}
        onRemoveTab={onRemoveVariant ? removeVariant : undefined}
        device={device}
        onDevice={setDevice}
        editable={canEdit}
        status={status}
        dirty={dirty}
        canUndo={history.length > 0}
        onUndo={undo}
        onSave={save}
        onExit={exit}
        canvas={
          <div className="flex min-w-0 flex-auto flex-col overflow-auto p-6 max-[901px]:flex-none max-[901px]:overflow-visible max-[641px]:p-3">
            {!canEdit ? (
              <div
                className="mx-auto mb-3 flex w-full items-center gap-2.5 rounded-lg bg-white px-3 py-2.5 text-[13px] leading-[19px] text-[#374151]"
                style={{ maxWidth: frameMax }}
              >
                <LockIcon size={16} className="flex-none" />
                <span>
                  {isControl
                    ? "You’re viewing the original page. Routely never changes it — edits only apply to variants."
                    : viewer
                      ? "Preview of " + name + ". Only Editors can change it."
                      : "Preview of " + name + ". Editing is locked while the experiment is live."}
                </span>
              </div>
            ) : null}
            <div
              className="mx-auto flex w-full flex-auto flex-col overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_#1118271F]"
              style={{ maxWidth: frameMax }}
            >
              <div
                aria-hidden
                className="flex h-[38px] flex-none items-center gap-2.5 border-b border-[#E5E7EB] bg-[#F3F4F6] px-3"
              >
                <span className="inline-flex gap-1.5">
                  <span className="size-2.5 rounded-full bg-[#D1D5DB]" />
                  <span className="size-2.5 rounded-full bg-[#D1D5DB]" />
                  <span className="size-2.5 rounded-full bg-[#D1D5DB]" />
                </span>
                <span className="h-6 min-w-0 flex-auto truncate rounded-md bg-white px-2.5 text-[12px] leading-6 text-[#6B7280]">
                  {shortUrl(pageUrl)}
                </span>
              </div>
              <div className="relative min-h-[560px] flex-auto max-[901px]:min-h-[70vh]">
                {session && via !== "popup" ? (
                  <iframe
                    key={attempt}
                    ref={setFrame}
                    src={via === "proxy" ? session.proxyUrl : session.frameUrl}
                    onLoad={onFrameLoad}
                    title={"Your page: " + shortUrl(pageUrl)}
                    // The customer's page runs its scripts but cannot navigate the dashboard away
                    // (no top navigation), open windows or submit forms while it is being edited.
                    // Framed directly it keeps its own origin. Through the proxy it is served from
                    // Routely's host, so it gets no origin at all (no `allow-same-origin`, and the
                    // proxy's CSP says the same): that holds for anything the frame navigates to.
                    sandbox={via === "proxy" ? "allow-scripts" : "allow-scripts allow-same-origin"}
                    // Chrome's Local Network Access: a public page in this frame may load the
                    // snippet from a private or loopback Routely (local development, self-hosting)
                    // only when the embedder delegates the permission. Both the current and the
                    // newer split names; unknown ones are ignored.
                    allow="local-network-access; local-network; loopback-network"
                    referrerPolicy="strict-origin"
                    className="absolute inset-0 size-full border-0 bg-white"
                  />
                ) : null}
                <ConnectionCard
                  state={link}
                  pageUrl={pageUrl}
                  snippet={session?.snippet ?? "unknown"}
                  viewer={viewer}
                  actions={actions}
                />
              </div>
            </div>
          </div>
        }
        panel={
          <>
            {canEdit && selected && ready ? (
              <LiveElementPanel
                key={selected.selector}
                el={selected}
                change={selectedChange}
                swatches={swatches}
                error={error}
                onEdit={edit}
                onReset={() => revert(selected.selector)}
                onClose={() => setSelected(null)}
              />
            ) : (
              <div className="flex flex-col gap-2.5 border-b border-[#EEF0F3] p-[18px]">
                <span className="text-[15px] font-semibold text-[#111827]">
                  {isControl
                    ? "Original page"
                    : !canEdit
                      ? name + " preview"
                      : "Select an element to edit"}
                </span>
                <span className="text-[13px] leading-[19px] text-pretty text-[#4B5563]">
                  {isControl
                    ? "This is the live page. Use the version switcher above to open a variant and make changes there."
                    : !canEdit
                      ? "These are the changes visitors in " + name + " see."
                      : ready
                        ? "Hover over the page and click a heading, text, button or image. Your edits only apply to " +
                          name +
                          "."
                        : "Once your page is connected, click a heading, text, button or image on it to edit it. Your edits only apply to " +
                          name +
                          "."}
                </span>
                {canEdit ? (
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
                {isControl ? "Changes" : "Changes in " + name + " (" + shown.length + ")"}
              </span>
              {shown.length === 0 ? (
                <span className="text-[13px] leading-[19px] text-[#6B7280]">
                  {isControl
                    ? "The Control has no changes, and it never will."
                    : "No changes yet. Edit at least one element, then save."}
                </span>
              ) : null}
              {shown.map((change) => {
                const placeholder = isPlaceholderChange(change);
                const missing = !placeholder && applied[change.selector] === false;
                return (
                  <div
                    key={change.id}
                    onMouseEnter={() => {
                      if (ready) send({ type: "routely:highlight", selector: change.selector });
                    }}
                    onMouseLeave={() => {
                      if (ready) send({ type: "routely:highlight", selector: selectedSelector });
                    }}
                    className="flex items-start gap-2.5 rounded-lg border border-[#EEF0F3] px-3 py-2.5"
                  >
                    <span className="flex min-w-0 flex-auto flex-col gap-0.5">
                      <span className="text-[13px] font-semibold text-[#374151]">
                        {kindLabel(change.kind)}
                      </span>
                      <span className="text-[13px] leading-[18px] [overflow-wrap:anywhere] text-[#4B5563]">
                        {describeChange(change)}
                      </span>
                      {placeholder || missing ? (
                        <span className="text-[12px] leading-4 font-medium text-[#92400E]">
                          {placeholder
                            ? "Made on a sample page, not yours — remove it."
                            : "Not found on this page."}
                        </span>
                      ) : null}
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => revert(change.selector)}
                        aria-label={"Remove change to " + (change.label || kindLabel(change.kind))}
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
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        alert
        z={95}
        width={420}
        title="Discard unsaved changes?"
        body="You have edits that haven’t been saved to this variant. If you leave now, they’ll be lost."
      >
        <button type="button" onClick={() => setConfirm(null)} className={cls.secondary}>
          Keep editing
        </button>
        <button type="button" onClick={discard} className={cls.danger}>
          Discard changes
        </button>
      </ConfirmDialog>
    </>
  );
}
