import type { VisualChange, VisualChangeSet } from "./contract";

/**
 * Applying an A/B test's visual changes to the page.
 *
 * The SDK runs in `<head>`, before `<body>` exists, so most targets are not in the document yet
 * when the decision is made. Changes are therefore applied as their elements appear: one pass
 * immediately, another on every DOM mutation, and a last one shortly after `DOMContentLoaded`.
 * After that, any change whose element never appeared is given up on — the page is left as it
 * is rather than watched indefinitely.
 *
 * Everything is bounded:
 *
 *  - **Looking for elements** stops one second after `DOMContentLoaded` (client-rendered
 *    content gets that long to appear), and at {@link HARD_STOP_MS} regardless.
 *  - **The observer** is disconnected {@link GUARD_MS} after that, or at the hard stop.
 *  - **Re-applying** — for frameworks that hydrate and overwrite the server-rendered text — is
 *    capped at {@link MAX_REAPPLY} per change, so the SDK can never fight a page in a loop.
 *
 * And everything is safe on a page Routely does not control:
 *
 *  - text is set with `textContent` (or `value` on an `<input>`), **never** `innerHTML`, so a
 *    change can only ever be text;
 *  - a colour must be `#rgb`, `#rrggbb`, `rgb()` or `rgba()`, and every other style value only
 *    letters, digits, spaces, `.`, `%`, `#` and `-` — no `(`, `;`, `:` or quotes, so no `url()`,
 *    no second declaration — each set as one property with `setProperty`;
 *  - an image must be an absolute `http:`/`https:` URL, so no `javascript:` or `data:` source;
 *  - a selector that does not parse, or resolves to a different tag than the change was made
 *    against, simply does not match;
 *  - nothing throws: every DOM access is inside a `try`.
 */

/** How long, at most, the SDK looks at the page at all. */
export const HARD_STOP_MS = 10_000;
/** How long after `DOMContentLoaded` a missing element is still waited for. */
export const SETTLE_AFTER_READY_MS = 1_000;
/** How long after giving up on missing elements applied ones are still guarded against reverts. */
export const GUARD_MS = 2_000;
/** Re-applications allowed per change after something on the page reverted it. */
export const MAX_REAPPLY = 5;

const MAX_TEXT = 2_000;
const MAX_ALT = 500;
const MAX_SRC = 2_048;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

export function isSafeColor(value: unknown): value is string {
  return typeof value === "string" && (HEX.test(value) || RGB.test(value));
}

export function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_SRC) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The style keys a change may set, and the CSS property each one sets (`!important`). */
export const STYLE_PROPS: [keyof VisualChangeSet, string][] = [
  ["backgroundColor", "background-color"],
  ["color", "color"],
  ["fontSize", "font-size"],
  ["fontWeight", "font-weight"],
  ["textAlign", "text-align"],
  ["padding", "padding"],
  ["margin", "margin"],
];

const CSS_VALUE = /^[\w\s.%#-]{1,64}$/;

/** A colour for the two colour keys; otherwise a value from the allow-listed characters. */
export function isSafeStyle(key: keyof VisualChangeSet, value: unknown): boolean {
  return key === "color" || key === "backgroundColor"
    ? isSafeColor(value)
    : typeof value === "string" && CSS_VALUE.test(value);
}

function isText(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= max);
}

/** True when every value a change sets is acceptable, and it sets at least one. */
export function isValidChange(change: VisualChange): boolean {
  const set = change.set || {};
  let any =
    set.text !== undefined || set.src !== undefined || set.alt !== undefined || set.hidden === true;
  for (const [key] of STYLE_PROPS) {
    if (set[key] === undefined) continue;
    if (!isSafeStyle(key, set[key])) return false;
    any = true;
  }
  return (
    any &&
    (set.hidden === undefined || set.hidden === true) &&
    isText(set.text, MAX_TEXT) &&
    isText(set.alt, MAX_ALT) &&
    (set.src === undefined || isSafeImageUrl(set.src))
  );
}

function tagOf(el: Element): string {
  return String(el.tagName).toLowerCase();
}

/** The `<img>` a change to an image addresses: the element itself, or the one in a `<picture>`. */
function imageOf(el: Element): Element | null {
  return tagOf(el) === "img" ? el : el.querySelector("img");
}

/** True when `el` is the element the change was authored against. */
export function matchesFingerprint(el: Element, change: VisualChange): boolean {
  const tag = change.fingerprint && change.fingerprint.tag;
  return !tag || String(tag).toLowerCase() === tagOf(el);
}

/**
 * Applies one change to one element. Returns whether it was applied. Never throws.
 *
 * A change with any invalid value is not applied at all — half of an intended change is a
 * different variant from the one being measured.
 */
export function applyChange(el: Element, change: VisualChange): boolean {
  try {
    if (!isValidChange(change) || !matchesFingerprint(el, change)) return false;
    const set = change.set;

    if (set.text !== undefined) {
      if (tagOf(el) === "input") (el as HTMLInputElement).value = set.text;
      else if (el.textContent !== set.text) el.textContent = set.text;
    }

    const style = (el as HTMLElement).style;
    for (const [key, prop] of STYLE_PROPS) {
      if (set[key] !== undefined) style.setProperty(prop, set[key] as string, "important");
    }
    if (set.hidden) style.setProperty("display", "none", "important");

    if (set.src !== undefined || set.alt !== undefined) {
      const img = imageOf(el);
      if (!img) return false;

      if (set.src !== undefined && img.getAttribute("src") !== set.src) {
        // A `srcset` or a `<picture>` source would win over `src` and show the old image.
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        const parent = img.parentElement;
        if (parent && tagOf(parent) === "picture") {
          const sources = parent.querySelectorAll("source");
          for (let i = 0; i < sources.length; i += 1) sources[i]!.remove();
        }
        img.setAttribute("src", set.src);
      }
      if (set.alt !== undefined) img.setAttribute("alt", set.alt);
    }

    return true;
  } catch {
    return false;
  }
}

/** True while the element still shows what the change set. Used to detect a revert. */
export function isApplied(el: Element, change: VisualChange): boolean {
  try {
    const set = change.set;
    if (set.text !== undefined) {
      const current = tagOf(el) === "input" ? (el as HTMLInputElement).value : el.textContent;
      if (current !== set.text) return false;
    }
    const style = (el as HTMLElement).style;
    for (const [key, prop] of STYLE_PROPS) {
      if (set[key] !== undefined && style.getPropertyPriority(prop) !== "important") return false;
    }
    if (set.hidden && style.getPropertyPriority("display") !== "important") return false;
    if (set.src !== undefined || set.alt !== undefined) {
      const img = imageOf(el);
      if (!img) return false;
      if (set.src !== undefined && img.getAttribute("src") !== set.src) return false;
      if (set.alt !== undefined && img.getAttribute("alt") !== set.alt) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** The page, as far as applying changes needs it. Injectable so this is testable without a DOM. */
export interface ApplyHost {
  /** `document.querySelector`, returning null for a selector that does not parse. */
  query(selector: string): Element | null;
  /** Calls `onChange` after DOM mutations until the returned function is called. */
  observe(onChange: () => void): () => void;
  /** Calls `callback` once the document has been parsed (immediately if it already has). */
  onReady(callback: () => void): void;
  setTimeout(callback: () => void, ms: number): unknown;
}

export interface ApplyResult {
  applied: number;
  total: number;
}

/**
 * Applies a variant's changes as their elements appear. `onSettled` is called exactly once:
 * when every change has been applied, or when the SDK stops waiting for the rest. The caller
 * lifts the anti-flicker overlay then. Never throws.
 */
export function applyChanges(
  changes: VisualChange[],
  onSettled: (result: ApplyResult) => void,
  host: ApplyHost = browserHost(),
): void {
  let pending = changes.filter(isValidChange);
  const total = changes.length;
  const applied: { change: VisualChange; reapplied: number }[] = [];
  let settled = false;
  let stopped = false;
  let disconnect: () => void = () => {};

  const settle = () => {
    if (settled) return;
    settled = true;
    try {
      onSettled({ applied: applied.length, total });
    } catch {
      // The caller's problem, never the page's.
    }
  };

  const stop = () => {
    stopped = true;
    pending = [];
    settle();
    try {
      disconnect();
    } catch {
      // Already gone.
    }
  };

  const pass = () => {
    if (stopped) return;

    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const change = pending[i]!;
      const el = host.query(change.selector);
      if (el && applyChange(el, change)) {
        pending.splice(i, 1);
        applied.push({ change, reapplied: 0 });
      }
    }

    for (const entry of applied) {
      if (entry.reapplied >= MAX_REAPPLY) continue;
      const el = host.query(entry.change.selector);
      if (el && !isApplied(el, entry.change) && applyChange(el, entry.change)) entry.reapplied += 1;
    }

    if (pending.length === 0) settle();
  };

  try {
    pass();
    disconnect = host.observe(pass);
    host.onReady(() => {
      pass();
      host.setTimeout(() => {
        pass();
        // Whatever has not appeared by now is not coming; stop holding the page for it.
        pending = [];
        settle();
        host.setTimeout(stop, GUARD_MS);
      }, SETTLE_AFTER_READY_MS);
    });
    host.setTimeout(stop, HARD_STOP_MS);
  } catch {
    stop();
  }
}

export function browserHost(): ApplyHost {
  return {
    query(selector) {
      try {
        return document.querySelector(selector);
      } catch {
        return null;
      }
    },
    observe(onChange) {
      if (typeof MutationObserver !== "function") return () => {};
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["src", "srcset", "alt", "style"],
      });
      return () => observer.disconnect();
    },
    onReady(callback) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", callback, { once: true });
      } else {
        callback();
      }
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
  };
}
