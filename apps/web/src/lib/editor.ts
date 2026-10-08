/**
 * The visual editor's canvas model (the prototype's `PAGE`, `IMAGES`, `CTA_COLORS`,
 * `pageVals`, `changeLabel` and its change-setting logic).
 *
 * The canvas is a representative landing page: the customer picks an element on it and edits
 * its text, colour or image. Each change is stored with a CSS `selector` — that, not the canvas
 * element, is what the SDK applies on the real page. `DEFAULT_SELECTORS` are starting points
 * only, chosen to hit the common structure of a landing-page hero; the editor lets the customer
 * edit the selector for each element, and an edited selector is kept on later value edits.
 */

import type { Change, ChangeProp, EditorElement } from "./domain";

export interface PageElement {
  label: string;
  kind: "text" | "button" | "image";
  orig: string;
}

export const PAGE: Record<EditorElement, PageElement> = {
  eyebrow: { label: "Eyebrow", kind: "text", orig: "KESTREL FOR TEAMS" },
  headline: { label: "Headline (H1)", kind: "text", orig: "Plan projects without the chaos" },
  sub: {
    label: "Paragraph",
    kind: "text",
    orig: "Roadmaps, tasks and docs in one workspace. Set up in minutes, loved by teams of every size.",
  },
  cta: { label: "Primary button", kind: "button", orig: "Start free trial" },
  image: { label: "Hero image", kind: "image", orig: "Product screenshot · board view" },
  trust: {
    label: "Trust line",
    kind: "text",
    orig: "Trusted by 4,000+ teams · No credit card required",
  },
};

export const EDITOR_ELEMENTS = Object.keys(PAGE) as EditorElement[];

export const IMAGES = [
  "Product screenshot · board view",
  "Product screenshot · timeline view",
  "Customer photo · team at whiteboard",
] as const;

export const CTA_COLORS = ["#0F1B35", "#2B59F0", "#F0603F", "#11A08F"] as const;

/** The canvas button's original background; a `bg` change back to it is removed. */
export const DEFAULT_CTA_BG = "#0F1B35";

/**
 * Starting selector per canvas element. Each is a selector *list*: an explicit
 * `data-routely` hook first (the reliable option, documented for customers), then a common
 * structural guess. Editable per change in the editor.
 */
export const DEFAULT_SELECTORS: Record<EditorElement, string> = {
  eyebrow: '[data-routely="eyebrow"], .eyebrow',
  headline: '[data-routely="headline"], h1',
  sub: '[data-routely="subheadline"], h1 + p',
  cta: '[data-routely="cta"], main a.button, main .btn-primary, main button[type="submit"]',
  image: '[data-routely="hero-image"], main img',
  trust: '[data-routely="trust"]',
};

export interface PageVals {
  eyebrow: string;
  headline: string;
  sub: string;
  cta: string;
  ctaBg: string;
  image: string;
  trust: string;
}

/** What the canvas shows for an arm: each element's changed value, or the original. */
export function pageVals(changes: readonly Change[] | null | undefined): PageVals {
  const g = (el: EditorElement, prop: ChangeProp) => {
    const c = (changes ?? []).find((x) => x.el === el && x.prop === prop);
    return c ? c.value : null;
  };
  return {
    eyebrow: g("eyebrow", "text") ?? PAGE.eyebrow.orig,
    headline: g("headline", "text") ?? PAGE.headline.orig,
    sub: g("sub", "text") ?? PAGE.sub.orig,
    cta: g("cta", "text") ?? PAGE.cta.orig,
    ctaBg: g("cta", "bg") ?? DEFAULT_CTA_BG,
    image: g("image", "image") ?? PAGE.image.orig,
    trust: g("trust", "text") ?? PAGE.trust.orig,
  };
}

/** e.g. "Headline (H1) · text", "Primary button · color". Falls back to the selector. */
export function changeLabel(c: Pick<Change, "el" | "prop" | "selector">): string {
  const base = c.el && PAGE[c.el] ? PAGE[c.el].label : c.selector;
  return base + (c.prop === "bg" ? " · color" : c.prop === "image" ? " · image" : " · text");
}

/** The original value an element's property is compared against. */
export function originalValue(el: EditorElement, prop: ChangeProp): string {
  return prop === "bg" ? DEFAULT_CTA_BG : PAGE[el].orig;
}

/**
 * Sets `el`'s `prop` to `value`, as the editor's inputs do. Setting it back to the original
 * removes the change; an existing change keeps its selector; a new one takes `selector` or the
 * element's default. Returns a new array.
 */
export function upsertChange(
  changes: readonly Change[],
  el: EditorElement,
  prop: ChangeProp,
  value: string,
  selector?: string,
): Change[] {
  const out = changes.map((c) => ({ ...c }));
  const k = out.findIndex((c) => c.el === el && c.prop === prop);
  if (value === originalValue(el, prop)) {
    if (k >= 0) out.splice(k, 1);
    return out;
  }
  if (k >= 0) {
    out[k]!.value = value;
    if (selector !== undefined) out[k]!.selector = selector;
    return out;
  }
  out.push({ selector: selector ?? selectorFor(changes, el), prop, value, el });
  return out;
}

/** Removes the change at `index`. */
export function removeChange(changes: readonly Change[], index: number): Change[] {
  return changes.filter((_, i) => i !== index).map((c) => ({ ...c }));
}

/** Removes every change on `el` ("Reset element"). */
export function resetElement(changes: readonly Change[], el: EditorElement): Change[] {
  return changes.filter((c) => c.el !== el).map((c) => ({ ...c }));
}

/** The selector currently used for `el`: an existing change's, else the default. */
export function selectorFor(changes: readonly Change[], el: EditorElement): string {
  return changes.find((c) => c.el === el)?.selector ?? DEFAULT_SELECTORS[el];
}

/** Sets the selector on every change of `el`. */
export function setElementSelector(
  changes: readonly Change[],
  el: EditorElement,
  selector: string,
): Change[] {
  return changes.map((c) => (c.el === el ? { ...c, selector } : { ...c }));
}

/** "3 changes" / "1 change". */
export function changeCount(n: number): string {
  return n + " change" + (n === 1 ? "" : "s");
}
