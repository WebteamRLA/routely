import type {
  EditorAppMessage,
  EditorPageMessage,
  ElementDescriptor,
  ElementKind,
  VisualChange,
  VisualChangeSet,
} from "./contract";
import { EDITOR_PROTOCOL_VERSION } from "./contract";
import { applyChange, isValidChange } from "./apply";
import type { EditorContext } from "./editor-bridge";

/**
 * The visual editor's in-page agent — `editor-agent.js`, a bundle of its own.
 *
 * It is loaded by `editor-bridge.ts` only after the Routely app answered the handshake (the app
 * origin, the window `hello` went to, the token from the URL), and it finds that context on
 * `window.__routelyEditor`. Ordinary visitors never download it.
 *
 * What it does, all of it driven by the app (`contract.ts` documents the protocol):
 *
 *  - **edit** mode: outlines the element under the pointer (`hover`), and on click reports it
 *    (`select`) instead of letting the page act on the click.
 *  - **preview**: restores the page to how it loaded, then applies the change set with the very
 *    `applyChange` visitors get, and reports which changes found their element (`applied`).
 *  - **highlight**: outlines the element a change in the app's list points at.
 *
 * Navigation is blocked in both modes — a followed link or a submitted form would end the editing
 * session. Like the rest of the SDK it never throws into the page: every handler is guarded.
 */

type Win = Window & { __routelyEditor?: EditorContext; __routelyAgent?: boolean };

const Z = "2147483646";
const MAX_TEXT = 2_000;
const MAX_LABEL_TEXT = 40;
const MAX_DEPTH = 6;
const BUTTON_DEPTH = 3;

const HEADINGS = /^h[1-6]$/;
const TEXT_TAGS = new Set([
  "p",
  "span",
  "a",
  "li",
  "label",
  "small",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "blockquote",
  "td",
  "th",
  "figcaption",
  "dt",
  "dd",
  "cite",
  "q",
  "div",
  "caption",
  "legend",
  "summary",
  "time",
]);
/** A hand-written id; generated ones (React `:r1:`, CMS `block-48213`) change between builds. */
const STABLE_ID = /^[A-Za-z][\w-]{0,63}$/;
const GENERATED_ID = /\d{4,}/;

const KIND_LABEL: Record<ElementKind, string> = {
  heading: "Heading",
  text: "Text",
  button: "Button",
  image: "Image",
};

const tagOf = (el: Element) => el.tagName.toLowerCase();
const clean = (text: string | null | undefined) => (text || "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------------------------------ */
/* Classification                                                                              */
/* ------------------------------------------------------------------------------------------ */

function isButtonLike(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === "button") return true;
  if (tag === "input") return /^(submit|button)$/i.test((el as HTMLInputElement).type);
  if (el.getAttribute("role") === "button") return true;
  const cls = typeof el.className === "string" ? el.className : "";
  return (tag === "a" || tag === "div" || tag === "span") && /btn|button/i.test(cls);
}

function hasOwnText(el: Element): boolean {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && clean(n.nodeValue)) return true;
  }
  return false;
}

/**
 * The element that actually holds `el`'s text when it is wrapped in a single inner element —
 * WordPress post titles are `<h2><a href>Title</a></h2>`, a button is often `<a><span>Buy</span></a>`.
 * Editing the inner element changes the text and keeps the link; replacing the outer element's
 * text would delete it. Stops at anything that isn't a lone wrapper, or at an image or icon.
 */
export function textHolder(el: Element): Element {
  let node = el;
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    const only = node.children.length === 1 ? node.children[0]! : null;
    if (!only || hasOwnText(node) || /^(img|svg|picture|video)$/.test(tagOf(only))) break;
    if (!clean(only.textContent)) break;
    node = only;
  }
  return node;
}

/** The editable element at or around `start`, and what kind it is — or null. */
export function pick(start: Element | null): { el: Element; kind: ElementKind } | null {
  const chain: Element[] = [];
  for (let el = start; el && chain.length < MAX_DEPTH; el = el.parentElement) {
    const tag = tagOf(el);
    if (tag === "body" || tag === "html") break;
    chain.push(el);
  }
  if (!chain.length) return null;

  for (let i = 0; i < chain.length && i < BUTTON_DEPTH; i += 1) {
    if (isButtonLike(chain[i]!)) return { el: textHolder(chain[i]!), kind: "button" };
  }
  const first = chain[0]!;
  if (tagOf(first) === "img") return { el: first, kind: "image" };
  if (tagOf(first) === "picture") {
    const img = first.querySelector("img");
    if (img) return { el: img, kind: "image" };
  }
  for (const el of chain) {
    if (HEADINGS.test(tagOf(el))) return { el: textHolder(el), kind: "heading" };
  }
  for (const el of chain) {
    if (TEXT_TAGS.has(tagOf(el)) && hasOwnText(el)) return { el, kind: "text" };
  }
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* Selectors                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function esc(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/[^\w-]/g, (c) => "\\" + c);
  }
}

function stableId(el: Element, doc: Document): string | null {
  const id = el.id;
  if (!id || !STABLE_ID.test(id) || GENERATED_ID.test(id)) return null;
  try {
    return doc.querySelectorAll("#" + esc(id)).length === 1 ? "#" + esc(id) : null;
  } catch {
    return null;
  }
}

/**
 * `#id` when the element has a stable unique id; otherwise the nearest such ancestor (or `body`)
 * followed by a `tag:nth-of-type(n)` chain. Returned only when it resolves back to `el`.
 */
export function selectorFor(el: Element, doc: Document): string | null {
  const own = stableId(el, doc);
  if (own) return own;
  const parts: string[] = [];
  let node: Element | null = el;
  let root = "body";
  while (node && tagOf(node) !== "body" && tagOf(node) !== "html") {
    const parent: Element | null = node.parentElement;
    if (!parent) return null;
    const tag = tagOf(node);
    let n = 1;
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (tagOf(sib) === tag) n += 1;
    }
    parts.unshift(tag + ":nth-of-type(" + n + ")");
    const anchor = stableId(parent, doc);
    if (anchor) {
      root = anchor;
      break;
    }
    node = parent;
  }
  const selector = root + " > " + parts.join(" > ");
  try {
    return doc.querySelector(selector) === el ? selector : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Descriptors                                                                                 */
/* ------------------------------------------------------------------------------------------ */

function textOf(el: Element): string {
  const raw = tagOf(el) === "input" ? (el as HTMLInputElement).value : el.textContent;
  return clean(raw).slice(0, MAX_TEXT);
}

function backgroundOf(el: Element, win: Window): string | undefined {
  try {
    const bg = win.getComputedStyle(el).backgroundColor;
    return bg && bg !== "transparent" && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(bg)
      ? bg
      : undefined;
  } catch {
    return undefined;
  }
}

/** What the app needs to know about `el`; null when no selector can find it again. */
export function describe(el: Element, kind: ElementKind, win: Window): ElementDescriptor | null {
  const selector = selectorFor(el, win.document);
  if (!selector) return null;
  const tag = tagOf(el);
  const current: VisualChangeSet = {};
  const fingerprint: ElementDescriptor["fingerprint"] = { tag };
  let summary: string;

  if (kind === "image") {
    const img = el as HTMLImageElement;
    const src = img.currentSrc || img.src || "";
    if (src) current.src = fingerprint.src = src;
    current.alt = img.getAttribute("alt") || "";
    summary = current.alt || src.split("/").pop()?.split("?")[0] || "image";
  } else {
    const text = textOf(el);
    current.text = fingerprint.text = text;
    summary = text;
    if (kind === "button") {
      const bg = backgroundOf(el, win);
      if (bg) current.backgroundColor = bg;
    }
  }

  if (summary.length > MAX_LABEL_TEXT) summary = summary.slice(0, MAX_LABEL_TEXT - 1) + "…";
  return {
    selector,
    kind,
    label: KIND_LABEL[kind] + (summary ? " · " + summary : ""),
    fingerprint,
    current,
    // Replacing the text of an element that holds more than text (an icon, nested markup)
    // would remove the rest, so the app doesn't offer a text change for it.
    textEditable: tag === "input" || el.children.length === 0,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Preview: snapshots taken before the first change to an element, restored before each preview */
/* ------------------------------------------------------------------------------------------ */

interface Snapshot {
  el: Element;
  html: string;
  value?: string;
  bg: string;
  bgPriority: string;
  img?: { el: Element; attrs: Record<string, string | null>; sources: [Element, Node | null][] };
}

const IMG_ATTRS = ["src", "srcset", "sizes", "alt"];

export function snapshot(el: Element): Snapshot {
  const style = (el as HTMLElement).style;
  const shot: Snapshot = {
    el,
    html: el.innerHTML,
    bg: style ? style.getPropertyValue("background-color") : "",
    bgPriority: style ? style.getPropertyPriority("background-color") : "",
  };
  if (tagOf(el) === "input") shot.value = (el as HTMLInputElement).value;
  const img = tagOf(el) === "img" ? el : el.querySelector("img");
  if (img) {
    const attrs: Record<string, string | null> = {};
    for (const name of IMG_ATTRS) attrs[name] = img.getAttribute(name);
    const sources: [Element, Node | null][] = [];
    const parent = img.parentElement;
    if (parent && tagOf(parent) === "picture") {
      parent.querySelectorAll("source").forEach((s) => sources.push([s, s.nextSibling]));
    }
    shot.img = { el: img, attrs, sources };
  }
  return shot;
}

export function restore(shot: Snapshot): void {
  try {
    const { el } = shot;
    if (el.innerHTML !== shot.html) el.innerHTML = shot.html;
    if (shot.value !== undefined) (el as HTMLInputElement).value = shot.value;
    const style = (el as HTMLElement).style;
    if (style) {
      if (shot.bg) style.setProperty("background-color", shot.bg, shot.bgPriority);
      else style.removeProperty("background-color");
    }
    if (shot.img) {
      const { el: img, attrs, sources } = shot.img;
      for (const name of IMG_ATTRS) {
        const value = attrs[name];
        if (value === null || value === undefined) img.removeAttribute(name);
        else img.setAttribute(name, value);
      }
      const parent = img.parentElement;
      for (const [source, next] of sources) {
        if (!source.isConnected && parent)
          parent.insertBefore(source, next && next.isConnected ? next : img);
      }
    }
  } catch {
    // A node the page itself removed: nothing left to restore.
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The agent                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function box(doc: Document, color: string, style: string): HTMLDivElement {
  const div = doc.createElement("div");
  div.setAttribute("data-routely-editor", "");
  div.style.cssText =
    "position:fixed;pointer-events:none;box-sizing:border-box;display:none;z-index:" +
    Z +
    ";border:2px " +
    style +
    " " +
    color +
    ";border-radius:3px;background:" +
    color +
    "14;transition:all .06s ease-out";
  doc.documentElement.appendChild(div);
  return div;
}

function place(div: HTMLDivElement, el: Element | null): void {
  if (!el || !el.isConnected) {
    div.style.display = "none";
    return;
  }
  const r = el.getBoundingClientRect();
  div.style.display = "block";
  div.style.left = r.left - 2 + "px";
  div.style.top = r.top - 2 + "px";
  div.style.width = r.width + 4 + "px";
  div.style.height = r.height + 4 + "px";
}

export function startAgent(win: Win = window as Win): boolean {
  const ctx = win.__routelyEditor;
  if (!ctx || win.__routelyAgent) return false;
  const target: Window | null = ctx.via === "parent" ? win.parent : (win.opener as Window | null);
  if (!target || target === win) return false;
  win.__routelyAgent = true;
  const doc = win.document;

  const post = (message: EditorPageMessage) => {
    try {
      target.postMessage(message, ctx.origin);
    } catch {
      // The editor closed.
    }
  };

  let mode: "edit" | "preview" = "edit";
  let hovered: Element | null = null;
  let selected: Element | null = null;
  const shots = new Map<Element, Snapshot>();
  const hoverBox = box(doc, "#0091FF", "dashed");
  const selectBox = box(doc, "#0060AD", "solid");

  const isOurs = (el: Element | null) => !!el && el.hasAttribute("data-routely-editor");
  const redraw = () => {
    place(hoverBox, mode === "edit" ? hovered : null);
    place(selectBox, selected);
  };

  const onMove = (event: Event) => {
    try {
      if (mode !== "edit") return;
      const found = pick(event.target as Element | null);
      const el = found && !isOurs(found.el) ? found.el : null;
      if (el === hovered) return;
      hovered = el;
      redraw();
      post({
        type: "routely:hover",
        token: ctx.token,
        element: found && el ? describe(el, found.kind, win) : null,
      });
    } catch {
      // Never into the page.
    }
  };

  const onLeave = () => {
    if (!hovered) return;
    hovered = null;
    redraw();
    post({ type: "routely:hover", token: ctx.token, element: null });
  };

  /** Clicks never reach the page: a followed link or a submit would end the session. */
  const onClick = (event: Event) => {
    try {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (mode !== "edit" || event.type !== "click") return;
      const found = pick(event.target as Element | null);
      if (!found || isOurs(found.el)) return;
      const element = describe(found.el, found.kind, win);
      if (!element) return;
      selected = found.el;
      redraw();
      post({ type: "routely:select", token: ctx.token, element });
    } catch {
      // Never into the page.
    }
  };
  const block = (event: Event) => {
    try {
      event.preventDefault();
      event.stopPropagation();
    } catch {
      // Ignore.
    }
  };

  const preview = (changes: readonly VisualChange[]) => {
    shots.forEach(restore);
    shots.clear();
    const results = changes.map((change) => {
      try {
        if (!change || !isValidChange(change)) return false;
        const el = doc.querySelector(change.selector);
        if (!el) return false;
        if (!shots.has(el)) shots.set(el, snapshot(el));
        return applyChange(el, change);
      } catch {
        return false;
      }
    });
    redraw();
    post({ type: "routely:applied", token: ctx.token, results });
  };

  const highlight = (selector: string | null) => {
    try {
      selected = selector ? doc.querySelector(selector) : null;
      if (selected && "scrollIntoView" in selected) {
        (selected as HTMLElement).scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    } catch {
      selected = null;
    }
    redraw();
  };

  const onMessage = (event: MessageEvent) => {
    try {
      if (event.origin !== ctx.origin || event.source !== target) return;
      const data = event.data as Partial<EditorAppMessage> | null;
      if (!data || typeof data !== "object" || data.token !== ctx.token) return;
      if (data.type === "routely:preview" && Array.isArray(data.changes)) preview(data.changes);
      else if (data.type === "routely:mode" && (data.mode === "edit" || data.mode === "preview")) {
        mode = data.mode;
        if (mode === "preview") hovered = null;
        redraw();
      } else if (data.type === "routely:highlight") {
        highlight(typeof data.selector === "string" ? data.selector : null);
      }
    } catch {
      // Never into the page.
    }
  };

  let frame = 0;
  const onViewport = () => {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      redraw();
    });
  };

  try {
    win.addEventListener("message", onMessage);
    doc.addEventListener("mouseover", onMove, true);
    doc.addEventListener("mouseleave", onLeave);
    for (const type of ["click", "auxclick", "dblclick", "contextmenu"]) {
      doc.addEventListener(type, onClick, true);
    }
    doc.addEventListener("submit", block, true);
    win.addEventListener("scroll", onViewport, true);
    win.addEventListener("resize", onViewport);
  } catch {
    return false;
  }

  post({
    type: "routely:ready",
    v: EDITOR_PROTOCOL_VERSION,
    token: ctx.token,
    url: String(win.location.href).split("#")[0] as string,
  });
  return true;
}

if (typeof window !== "undefined") {
  try {
    startAgent();
  } catch {
    // Never into the page.
  }
}
