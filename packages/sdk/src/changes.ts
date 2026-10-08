import type { ChangeConfig } from "./contract";

/**
 * Applying an A/B arm's element changes to the page.
 *
 * The SDK runs in `<head>`, before `<body>` exists, so the elements a change targets usually
 * are not there yet. Changes are applied as soon as their elements appear — a
 * `MutationObserver` re-runs them while the document is parsed — and the page is revealed once
 * every change has found its element, or at `DOMContentLoaded`, or after a hard ceiling,
 * whichever comes first. The anti-flicker snippet's own timeout remains the backstop.
 *
 * Re-application is idempotent (a value already in place is not written again), which is what
 * lets the observer keep re-applying through the window without feeding itself mutations, and
 * what restores a change a framework's hydration overwrote during that window.
 *
 * Nothing here throws: a selector the browser rejects, an element that refuses a style, or an
 * observer that is unavailable each leave that change unapplied and the page untouched.
 */

/** Longest the page is held for changes whose elements never appear. */
export const APPLY_WINDOW_MS = 1500;

/** The slice of an element this module touches, so tests need no DOM. */
export interface ChangeTarget {
  tagName: string;
  textContent: string | null;
  style: {
    getPropertyValue(name: string): string;
    setProperty(name: string, value: string, priority?: string): void;
  };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface ChangeRoot {
  querySelector(selector: string): ChangeTarget | null;
}

/** Only absolute http(s), protocol-relative or root-relative image URLs are ever written. */
function safeImageUrl(value: string): string | null {
  const v = value.trim();
  return /^(https?:)?\/\//i.test(v) || /^\/(?!\/)/.test(v) ? v : null;
}

function setStyle(el: ChangeTarget, name: string, value: string): void {
  // `important` so the customer's stylesheet, which usually has the more specific selector,
  // does not quietly win over the variant.
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value, "important");
}

/** Applies one change to one element. */
export function applyToElement(el: ChangeTarget, change: ChangeConfig): void {
  if (change.prop === "text") {
    if (el.textContent !== change.value) el.textContent = change.value;
  } else if (change.prop === "bg") {
    setStyle(el, "background-color", change.value);
  } else if (change.prop === "image") {
    const url = safeImageUrl(change.value);
    if (!url) return;
    if (String(el.tagName).toUpperCase() === "IMG") {
      // `srcset` would win over `src` in every browser that supports it.
      if (el.getAttribute("srcset") !== null) el.removeAttribute("srcset");
      if (el.getAttribute("src") !== url) el.setAttribute("src", url);
    } else {
      setStyle(el, "background-image", `url("${url.replace(/["\\\n]/g, encodeURIComponent)}")`);
    }
  }
}

/**
 * Applies a change to the first element its selector list matches — the editor writes lists
 * such as `[data-routely="headline"], h1`, and `querySelector` on the whole list returns the
 * first element, in document order, that matches any of them. Returns true once applied; a selector the
 * browser rejects counts as no match.
 */
export function applyChange(root: ChangeRoot, change: ChangeConfig): boolean {
  let el: ChangeTarget | null;
  try {
    el = root.querySelector(change.selector);
  } catch {
    return false;
  }
  if (!el) return false;
  try {
    applyToElement(el, change);
  } catch {
    // An element that refuses a style is left as it is.
  }
  return true;
}

/** Applies every change; returns how many found no element yet. */
export function applyAll(root: ChangeRoot, changes: ChangeConfig[]): number {
  let missing = 0;
  for (const change of changes) if (!applyChange(root, change)) missing += 1;
  return missing;
}

/**
 * Applies changes as their elements appear and calls `applied` exactly once — as soon as every
 * change has found its element, at `DOMContentLoaded`, or after `APPLY_WINDOW_MS`, whichever is
 * first. The observer keeps re-applying until the window closes, so a framework re-rendering an
 * element during hydration does not silently revert the variant.
 */
export function applyWhenReady(changes: ChangeConfig[], applied: () => void): void {
  let revealed = false;
  let observer: MutationObserver | null = null;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    applied();
  };
  const run = () => {
    try {
      if (applyAll(document, changes) === 0) reveal();
    } catch {
      reveal();
    }
  };
  const stop = () => {
    run();
    try {
      observer?.disconnect();
    } catch {
      // Already gone.
    }
    reveal();
  };

  try {
    run();
    if (typeof MutationObserver === "function") {
      observer = new MutationObserver(run);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    // Parsing is over: anything still missing is not in the server-rendered page.
    if (document.readyState !== "loading") reveal();
    else
      document.addEventListener("DOMContentLoaded", () => {
        run();
        reveal();
      });
    setTimeout(stop, APPLY_WINDOW_MS);
  } catch {
    reveal();
  }
}
