"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import type { ArmDraft, Change, EditorElement } from "@/lib/domain";
import {
  CTA_COLORS,
  DEFAULT_SELECTORS,
  LIVE_TIMEOUT_MS,
  PAGE,
  changeCount,
  changeLabel,
  editorHint,
  liveFrameUrl,
  liveHost,
  pageVals,
  removeChange,
  resetElement,
  selectorFor,
  setElementSelector,
  upsertChange,
  type EditorSource,
  type LiveState,
} from "@/lib/editor";
import { ArmSwatch, BrowserBar, FieldError, Segmented, Spinner } from "@/components/rl";
import { cn } from "@/lib/utils";

import { MockHero, MockSiteHeader, siteBrand } from "./mock-page";
import { isImageValue } from "./preview-link";

export interface VisualEditorProps {
  open: boolean;
  /** Control first; control is read-only. */
  arms: ArmDraft[];
  /** The arm to open on. 0 opens Control in preview mode. */
  initialArm: number;
  /** The page the variants are built on, shown in the browser chrome. */
  url: string;
  projectName: string;
  onChange: (arm: number, changes: Change[]) => void;
  onClose: () => void;
}

/** `[data-routely="headline"]` → `headline`, for the help text. */
function hookName(el: EditorElement): string {
  return /data-routely="([^"]+)"/.exec(DEFAULT_SELECTORS[el])?.[1] ?? el;
}

function selectorError(selector: string): string | null {
  const s = selector.trim();
  if (!s) return 'Enter a CSS selector, e.g. h1 or [data-routely="headline"].';
  try {
    document.createDocumentFragment().querySelector(s);
    return null;
  } catch {
    return "That isn’t a valid CSS selector.";
  }
}

type Mode = "edit" | "preview";
type Device = "desktop" | "mobile";

/**
 * The visual editor (design v2, markup L1834–1922): full-screen, arm tabs, a source toggle
 * (Live page | Edit elements), Edit/Preview (snapshot only), Desktop/Mobile, and the panel.
 *
 * "Live page" frames the real page URL so the customer can check it. It is a view only: nothing
 * is injected into the frame, and a page that refuses to be embedded is only detected by the
 * load timeout (a blocked frame still fires `load` in some browsers, showing their own error
 * page). "Edit elements" is the representative snapshot where changes are made; each change
 * carries the CSS selector the SDK applies it to on the real site, editable per element here.
 */
export function VisualEditor({
  open,
  arms,
  initialArm,
  url,
  projectName,
  onChange,
  onClose,
}: VisualEditorProps) {
  const [arm, setArm] = useState(initialArm);
  const [sel, setSel] = useState<EditorElement | null>(null);
  const [mode, setMode] = useState<Mode>(initialArm === 0 ? "preview" : "edit");
  const [device, setDevice] = useState<Device>("desktop");
  const [source, setSource] = useState<EditorSource>("live");
  const [live, setLive] = useState<LiveState>("loading");
  /** Bumped to remount the live frame (retry, re-entering the live view). */
  const [frameKey, setFrameKey] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  /** Selector typed for an element that has no change yet, per arm. */
  const [pending, setPending] = useState<Record<string, string>>({});
  /** Image URL as typed (only valid values are stored as changes). */
  const [imageInput, setImageInput] = useState<Record<number, string>>({});

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setArm(initialArm);
      setSel(null);
      setMode(initialArm === 0 ? "preview" : "edit");
      setDevice("desktop");
      setSource("live");
      setLive("loading");
      setFrameKey((k) => k + 1);
    }
  }

  const frameUrl = liveFrameUrl(url);
  const liveState: LiveState = frameUrl ? live : "error";
  const host = liveHost(url);

  const ei = Math.min(arm, Math.max(arms.length - 1, 0));
  const current = arms[ei];
  const isCtrl = ei === 0;
  const preview = mode === "preview" || isCtrl;
  const isLive = source === "live";
  const changes = current?.changes ?? [];

  const close = () => {
    onClose();
    if (!isCtrl && current && changes.length) {
      toast(`${current.name} saved · ${changeCount(changes.length)}`);
    }
  };

  // A frame that never fires `load` (unreachable host, mixed content) is reported as an error.
  useEffect(() => {
    if (!open || source !== "live" || !frameUrl || live !== "loading") return;
    const t = window.setTimeout(() => setLive("error"), LIVE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [open, source, frameUrl, live, frameKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") document.getElementById("rl-editor-close")?.click();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined" || !current) return null;

  const vals = pageVals(changes);
  const P = sel && !preview && !isLive ? PAGE[sel] : null;
  const pendingKey = (el: EditorElement) => `${ei}:${el}`;
  const selectorOf = (el: EditorElement) =>
    changes.some((c) => c.el === el)
      ? selectorFor(changes, el)
      : (pending[pendingKey(el)] ?? DEFAULT_SELECTORS[el]);
  const set = (next: Change[]) => onChange(ei, next);
  const setValue = (el: EditorElement, prop: Change["prop"], value: string) =>
    set(
      upsertChange(
        changes,
        el,
        prop,
        value,
        changes.some((c) => c.el === el) ? undefined : selectorOf(el),
      ),
    );

  const switchArm = (i: number) => {
    setArm(i);
    setSel(null);
    setMode(i === 0 ? "preview" : "edit");
  };

  /** Back to the live view: a fresh frame, so its state is that frame's. */
  const showLive = () => {
    if (isLive) return;
    setSource("live");
    setSel(null);
    setLive("loading");
    setFrameKey((k) => k + 1);
  };
  const showSnapshot = () => {
    if (!isLive) return;
    setSource("snap");
    setSel(null);
    setMode(isCtrl ? "preview" : "edit");
  };
  const retryLive = () => {
    setLive("loading");
    setFrameKey((k) => k + 1);
  };

  const hint = editorHint({
    source,
    live: liveState,
    host,
    armName: current.name,
    isControl: isCtrl,
    preview,
  });

  const sid = P ? sel! : null;
  const selector = sid ? selectorOf(sid) : "";
  const selErr = sid ? selectorError(selector) : null;
  const imgTyped =
    sid === "image" ? (imageInput[ei] ?? changes.find((c) => c.el === "image")?.value ?? "") : "";
  const imgErr =
    sid === "image" && imgTyped.trim() && !isImageValue(imgTyped)
      ? "Use an image URL starting with https:// or a path on your site starting with /."
      : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Visual editor"
      className="fixed inset-0 z-[90] flex flex-col bg-[#E9ECF2] text-foreground"
    >
      <div className="flex flex-wrap items-center gap-3 bg-navy px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <div aria-hidden className="flex size-5 overflow-hidden rounded-[5px]">
            <div className="flex-1 bg-brand" />
            <div className="flex-1 bg-coral" />
          </div>
          <span className="font-heading font-semibold">Visual editor</span>
        </div>
        <Segmented
          variant="dark"
          role="tab"
          ariaLabel="Version"
          className="w-auto flex-wrap"
          itemClassName="flex items-center gap-1.5"
          options={arms.map((a, i) => ({
            value: String(i),
            label: (
              <>
                <ArmSwatch position={i} size={8} />
                {a.name}
              </>
            ),
          }))}
          value={String(ei)}
          onChange={(v) => switchArm(Number(v))}
        />
        <div className="flex-1" />
        <Segmented
          variant="dark"
          ariaLabel="Canvas"
          className="w-auto"
          options={[
            { value: "live", label: "Live page" },
            { value: "snap", label: "Edit elements" },
          ]}
          value={source}
          onChange={(k) => (k === "live" ? showLive() : showSnapshot())}
        />
        {!isLive ? (
          <Segmented
            variant="dark"
            ariaLabel="Mode"
            className="w-auto"
            disabled={isCtrl}
            options={[
              { value: "edit", label: "Edit" },
              { value: "preview", label: "Preview" },
            ]}
            value={preview ? "preview" : "edit"}
            onChange={(k) => {
              setMode(k);
              setSel(null);
            }}
          />
        ) : null}
        <Segmented
          variant="dark"
          ariaLabel="Device"
          className="w-auto"
          options={[
            { value: "desktop", label: "Desktop" },
            { value: "mobile", label: "Mobile" },
          ]}
          value={device}
          onChange={setDevice}
        />
        <button
          id="rl-editor-close"
          type="button"
          onClick={close}
          className="h-9 cursor-pointer rounded-md border-0 bg-brand px-4 font-extrabold text-white hover:bg-brand-hover"
        >
          Save &amp; close
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto min-[1000px]:flex-row">
        <div className="flex min-w-0 flex-none flex-col items-center gap-2.5 overflow-auto p-[18px] min-[1000px]:flex-1">
          <div className="self-stretch text-center text-[12.5px] font-semibold text-ink-2">
            {hint}
          </div>
          <div
            className={cn(
              "max-w-[1100px] flex-none overflow-hidden rounded-lg bg-white shadow-[0_10px_30px_rgba(10,22,51,0.12)]",
              device === "mobile" ? "w-[min(390px,100%)]" : "w-full",
            )}
          >
            <BrowserBar url={url || "https://example.com/product"} />
            {isLive ? (
              <div
                className="relative bg-white"
                style={{ height: device === "mobile" ? 700 : "min(70vh, 720px)" }}
              >
                {frameUrl && liveState !== "error" ? (
                  <iframe
                    key={`${frameKey}:${frameUrl}`}
                    src={frameUrl}
                    title="Live page preview"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    onLoad={() => setLive((s) => (s === "loading" ? "ok" : s))}
                    className="block size-full border-0"
                  />
                ) : null}
                {liveState === "loading" ? (
                  <div
                    role="status"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white"
                  >
                    <Spinner
                      size={28}
                      thickness={3}
                      className="animate-[rl-spin_0.8s_linear_infinite]"
                    />
                    <div className="font-bold">Loading {host}…</div>
                    <div className="text-[12.5px] text-ink-3">
                      Fetching the live page for the editor.
                    </div>
                  </div>
                ) : null}
                {liveState === "error" ? (
                  <div
                    role="alert"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-white p-6 text-center"
                  >
                    <span
                      aria-hidden
                      className="flex size-9 items-center justify-center rounded-full bg-danger-bg font-black text-danger-text"
                    >
                      !
                    </span>
                    <div className="font-heading text-base font-bold">
                      {frameUrl ? `Couldn’t load ${host}` : "No page URL yet"}
                    </div>
                    <div className="max-w-[440px] text-[13px] leading-normal text-ink-3">
                      {frameUrl
                        ? "The page didn’t respond in time or blocks being embedded (X-Frame-Options / CSP). Check the URL and retry, or edit the page snapshot instead."
                        : "Enter a full page URL (https://…) in Setup, then open the editor again."}
                    </div>
                    <div className="mt-1 flex flex-wrap justify-center gap-2">
                      {frameUrl ? (
                        <button
                          type="button"
                          onClick={retryLive}
                          className="h-9 cursor-pointer rounded-md border border-input bg-white px-3.5 font-bold text-foreground hover:bg-muted"
                        >
                          Retry
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={showSnapshot}
                        className="h-9 cursor-pointer rounded-md border-0 bg-brand px-3.5 font-extrabold text-white hover:bg-brand-hover"
                      >
                        Edit snapshot instead
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <MockSiteHeader brand={siteBrand(projectName)} />
                <MockHero
                  vals={vals}
                  pageUrl={url}
                  layout="editor"
                  mobile={device === "mobile"}
                  interactive={
                    preview
                      ? undefined
                      : {
                          selected: sel,
                          changed: (el) => changes.some((c) => c.el === el),
                          onSelect: (el) => setSel(el),
                        }
                  }
                />
              </>
            )}
          </div>
        </div>

        <aside className="flex w-full flex-none flex-col overflow-auto border-l border-border bg-white min-[1000px]:w-[340px]">
          <div className="flex items-center gap-2 border-b border-divider px-[18px] py-4">
            <ArmSwatch position={ei} />
            <span className="font-heading font-semibold">{current.name}</span>
            <span className="ml-auto text-[12.5px] font-bold text-ink-3">
              {changeCount(changes.length)}
            </span>
          </div>

          {isLive ? (
            <div className="flex flex-col gap-2.5 border-b border-divider bg-[#FAFBFF] p-[18px]">
              <div className="text-[13.5px] leading-[1.55] text-ink-2">
                Live view of <b>{host}</b>. Use it to check the real page; switch to{" "}
                <b>Edit elements</b> to change text, buttons and images for this variant.
              </div>
              <button
                type="button"
                onClick={showSnapshot}
                className="h-[34px] cursor-pointer self-start rounded-md border-0 bg-brand px-3.5 text-[13px] font-extrabold text-white hover:bg-brand-hover"
              >
                Edit elements →
              </button>
              {frameUrl ? (
                <a
                  href={frameUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start text-[12.5px] font-bold"
                >
                  Open page in a new tab ↗
                </a>
              ) : null}
            </div>
          ) : null}
          {isCtrl ? (
            <div className="p-[18px] text-[13.5px] leading-[1.55] text-ink-2">
              You’re viewing Control: the live page exactly as it is today. Routely never changes
              it. Select a variant tab to make edits.
            </div>
          ) : null}
          {!isCtrl && !preview && !isLive && !P ? (
            <div className="p-[18px] text-[13.5px] leading-[1.55] text-ink-2">
              Select an element on the page to change its text, image or button style. Supported:
              headings, paragraphs, buttons, images.
            </div>
          ) : null}

          {P && sid ? (
            <div className="flex flex-col gap-3 border-b border-divider bg-[#FAFBFF] p-[18px]">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-extrabold tracking-[0.08em] text-brand uppercase">
                  Editing · {P.label}
                </span>
                <button
                  type="button"
                  aria-label="Close element"
                  onClick={() => setSel(null)}
                  className="cursor-pointer border-0 bg-transparent text-lg text-ink-3"
                >
                  ×
                </button>
              </div>
              <div className="text-xs text-ink-3">Original: “{P.orig}”</div>

              {P.kind !== "image" ? (
                <textarea
                  aria-label={`${P.label} text`}
                  rows={3}
                  value={vals[sid as Exclude<EditorElement, "image">]}
                  onChange={(e) => setValue(sid, "text", e.target.value)}
                  className="resize-y rounded-lg border border-brand px-3 py-2.5 text-sm shadow-[0_0_0_3px_rgba(43,89,240,0.12)] outline-none"
                />
              ) : null}

              {P.kind === "button" ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-extrabold">Button color</span>
                  <div className="flex gap-2.5">
                    {CTA_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Button color ${c}`}
                        aria-pressed={vals.ctaBg === c}
                        onClick={() => setValue(sid, "bg", c)}
                        className="size-7 cursor-pointer rounded-full border-0"
                        style={{
                          background: c,
                          boxShadow:
                            vals.ctaBg === c ? "0 0 0 2px #FFFFFF, 0 0 0 4px #2B59F0" : "none",
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {P.kind === "image" ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-extrabold">Replace image</span>
                  <input
                    value={imgTyped}
                    placeholder="https://cdn.example.com/hero.png or /images/hero.png"
                    onChange={(e) => {
                      const v = e.target.value;
                      setImageInput((m) => ({ ...m, [ei]: v }));
                      if (!v.trim()) set(resetElement(changes, "image"));
                      else if (isImageValue(v)) setValue("image", "image", v.trim());
                    }}
                    aria-invalid={imgErr ? true : undefined}
                    className={cn(
                      "h-10 rounded-md border bg-white px-3 font-mono text-[12.5px] outline-none focus:border-brand focus:ring-3 focus:ring-primary/15",
                      imgErr ? "border-danger" : "border-input",
                    )}
                  />
                  <FieldError>{imgErr}</FieldError>
                  <span className="text-xs leading-normal text-ink-3">
                    Paste the address of an image from your media library. Routely swaps the
                    element’s image source for visitors in this variant.
                  </span>
                </label>
              ) : null}

              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-extrabold">CSS selector on your site</span>
                <input
                  value={selector}
                  spellCheck={false}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (changes.some((c) => c.el === sid)) set(setElementSelector(changes, sid, v));
                    else setPending((m) => ({ ...m, [pendingKey(sid)]: v }));
                  }}
                  aria-invalid={selErr ? true : undefined}
                  className={cn(
                    "h-10 rounded-md border bg-white px-3 font-mono text-[12.5px] outline-none focus:border-brand focus:ring-3 focus:ring-primary/15",
                    selErr ? "border-danger" : "border-input",
                  )}
                />
                <FieldError>{selErr}</FieldError>
                <span className="text-xs leading-normal text-ink-3">
                  This is the element the change is applied to on your live page. Add{" "}
                  <code className="font-mono text-[11.5px] text-foreground">
                    data-routely=&quot;{hookName(sid)}&quot;
                  </code>{" "}
                  to that element on your site, or edit the selector to match it.
                </span>
              </label>

              <button
                type="button"
                onClick={() => {
                  set(resetElement(changes, sid));
                  setImageInput((m) => ({ ...m, [ei]: "" }));
                }}
                className="cursor-pointer self-start border-0 bg-transparent p-0 text-[12.5px] font-bold text-danger-text"
              >
                Reset to original
              </button>
            </div>
          ) : null}

          {!isCtrl ? (
            <div className="flex flex-col gap-2 px-[18px] py-4">
              <div className="text-[11.5px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">
                Changes in this variant
              </div>
              {changes.length === 0 ? (
                <div className="text-[13px] text-ink-3">
                  No changes yet. This variant currently looks identical to Control.
                </div>
              ) : null}
              {changes.map((c, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-divider p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (c.el) {
                        setSource("snap");
                        setMode("edit");
                        setSel(c.el);
                      }
                    }}
                    className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
                  >
                    <div className="text-xs font-extrabold text-ink-2">{changeLabel(c)}</div>
                    <div className="mt-0.5 text-[13px] break-words text-foreground">{c.value}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
                      {c.selector}
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label="Remove change"
                    onClick={() => set(removeChange(changes, i))}
                    className="cursor-pointer border-0 bg-transparent text-base text-danger-text"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
