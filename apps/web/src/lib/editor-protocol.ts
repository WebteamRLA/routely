/**
 * The app's half of the visual editor's `postMessage` protocol (`@routely/sdk/contract`, "Visual
 * editor bridge"), plus the pure editing rules the live editor runs on.
 *
 * Everything that arrives from the customer's page is **untrusted**: another site can frame or
 * open the same page, the page's own scripts can post anything, and the agent itself runs inside a
 * document Routely does not control. So a message is accepted only when all three hold —
 *
 *  1. `event.origin` is exactly the tested page's origin (bound into the session token);
 *  2. `event.source` is the frame or popup window this editor opened;
 *  3. `data.token` is the token this editor was issued —
 *
 * and then its body is re-validated field by field: an element descriptor's strings are capped and
 * its kind and tag checked before any of it can become part of a stored change. Changes still pass
 * `validation/visual-change.ts` on the server when they are saved.
 *
 * Pure and dependency-free (types from the SDK contract only), so it is unit-tested without a DOM
 * and the client bundle carries no validation library for it.
 */

import type {
  EditorAppMessage,
  EditorPageMessage,
  ElementDescriptor,
  ElementKind,
  VisualChange as WireChange,
} from "@routely/sdk/contract";
import { EDITOR_PROTOCOL_VERSION } from "@routely/sdk/contract";

import type { VisualChange } from "@/validation/visual-change";

/** Same cap as `MAX_CHANGES_PER_VARIANT` (`validation/visual-change.ts`; a test pins the two). */
export const EDITOR_MAX_CHANGES = 50;
export const EDITOR_MAX_TEXT = 2_000;
export const EDITOR_MAX_ALT = 500;
export const EDITOR_MAX_SRC = 2_048;

const KINDS: ReadonlySet<string> = new Set(["heading", "text", "button", "image", "block"]);
/** The style values an element reports and a change can set, besides text and image fields. */
export const STYLE_KEYS = [
  "backgroundColor",
  "color",
  "fontSize",
  "fontWeight",
  "textAlign",
  "padding",
  "margin",
] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];
const TAG = /^[a-z][a-z0-9-]*$/i;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

/** What `POST /api/editor/token` returns (`server/services/visual-editor.service.ts`). */
export interface EditorSession {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** The tested page, as stored (with a scheme). */
  pageUrl: string;
  /** `pageUrl` with `#_rt_edit=<token>` — what the editor loads. */
  frameUrl: string;
  /** The only origin the editor accepts messages from. */
  origin: string;
  /**
   * The same page through Routely's proxy (`/api/editor/proxy`), for a site that refuses to be
   * framed. Relative (served beside the dashboard) unless a separate proxy host is configured. The
   * copy is sandboxed into an opaque origin, so its messages arrive from `OPAQUE_ORIGIN`.
   */
  proxyUrl: string;
  /**
   * What the last tracking check said about the tested page, used only to word the message when
   * the page does not answer: `found` (the snippet was seen there), `missing`, or `unknown` (never
   * checked, or the check could not reach the page).
   */
  snippet: "found" | "missing" | "unknown";
}

// --- Accepting messages -----------------------------------------------------------------------

/** `event.origin` of a message from a sandboxed document without `allow-same-origin`. */
export const OPAQUE_ORIGIN = "null";

export interface MessageGuard {
  /** The tested page's origin, from the session. */
  origin: string;
  /** The frame's `contentWindow`, or the popup. */
  source: unknown;
}

/** Checks 1 and 2: the message comes from the window this editor opened, on the expected origin. */
export function isFromEditorPage(
  event: { origin: string; source: unknown },
  guard: MessageGuard,
): boolean {
  return (
    guard.source !== null &&
    guard.source !== undefined &&
    event.source === guard.source &&
    event.origin === guard.origin
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cap(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

/**
 * An element descriptor with every field checked and every string capped, or null when it is not
 * one. Never trusts a selector it would have to shorten: a cut-off selector names a different
 * element.
 */
export function readDescriptor(value: unknown): ElementDescriptor | null {
  if (!isRecord(value)) return null;
  const { selector, kind, label, fingerprint, current, textEditable } = value;

  if (typeof selector !== "string" || selector.trim() === "" || selector.length > 1_000)
    return null;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  if (!isRecord(fingerprint) || typeof fingerprint.tag !== "string") return null;
  const tag = fingerprint.tag.toLowerCase();
  if (tag.length > 32 || !TAG.test(tag)) return null;

  const now = isRecord(current) ? current : {};
  const out: ElementDescriptor = {
    selector,
    kind: kind as ElementKind,
    label: (cap(label, 200) ?? "").trim(),
    fingerprint: { tag },
    current: {},
    textEditable: textEditable === true,
  };
  const fpText = cap(fingerprint.text, 500);
  const fpSrc = cap(fingerprint.src, EDITOR_MAX_SRC * 2);
  if (fpText !== undefined) out.fingerprint.text = fpText;
  if (fpSrc !== undefined) out.fingerprint.src = fpSrc;

  const text = cap(now.text, 20_000);
  const src = cap(now.src, EDITOR_MAX_SRC * 2);
  const alt = cap(now.alt, 5_000);
  if (text !== undefined) out.current.text = text;
  if (src !== undefined) out.current.src = src;
  if (alt !== undefined) out.current.alt = alt;
  for (const key of STYLE_KEYS) {
    const v = cap(now[key], 200);
    if (v !== undefined) out.current[key] = v;
  }
  const crumbs = value.crumbs;
  if (Array.isArray(crumbs)) {
    out.crumbs = crumbs
      .slice(0, 5)
      .map((crumb) => (typeof crumb === "string" ? crumb.slice(0, 40) : ""))
      .filter(Boolean);
  }
  return out;
}

/**
 * Check 3 and the body: the message as a well-formed `EditorPageMessage` carrying `token`, or null.
 * Call only after `isFromEditorPage`.
 */
export function readPageMessage(data: unknown, token: string): EditorPageMessage | null {
  if (!isRecord(data) || typeof data.type !== "string" || data.token !== token) return null;

  switch (data.type) {
    case "routely:hello":
    case "routely:ready": {
      if (data.v !== EDITOR_PROTOCOL_VERSION) return null;
      const url = typeof data.url === "string" ? data.url.slice(0, 4_096) : "";
      return { type: data.type, v: EDITOR_PROTOCOL_VERSION, token, url };
    }
    case "routely:hover": {
      if (data.element === null) return { type: "routely:hover", token, element: null };
      const element = readDescriptor(data.element);
      return element ? { type: "routely:hover", token, element } : null;
    }
    case "routely:select": {
      const element = readDescriptor(data.element);
      return element ? { type: "routely:select", token, element } : null;
    }
    case "routely:applied": {
      const results = data.results;
      if (!Array.isArray(results) || results.length > EDITOR_MAX_CHANGES) return null;
      if (!results.every((r) => typeof r === "boolean")) return null;
      return { type: "routely:applied", token, results: results as boolean[] };
    }
    case "routely:error":
      return data.code === "agent_load_failed"
        ? { type: "routely:error", token, code: "agent_load_failed" }
        : null;
    default:
      return null;
  }
}

/** Distributes `Omit` over the union, so each message keeps its own fields. */
type WithoutToken<T> = T extends unknown ? Omit<T, "token"> : never;

/** A message to the page, addressed with the session token. */
export function appMessage(
  token: string,
  message: WithoutToken<EditorAppMessage>,
): EditorAppMessage {
  return { ...message, token } as EditorAppMessage;
}

/** The init that answers a hello. */
export function initMessage(token: string): EditorAppMessage {
  return { type: "routely:init", v: EDITOR_PROTOCOL_VERSION, token };
}

/** Stored changes as the page applies them: only what the SDK reads (`contract.ts`). */
export function toWireChanges(changes: readonly VisualChange[]): WireChange[] {
  return changes.map((change) => ({
    selector: change.selector,
    kind: change.kind,
    fingerprint: { tag: change.fingerprint.tag },
    set: { ...change.set },
  }));
}

// --- Editing ----------------------------------------------------------------------------------

export type EditKey = "text" | "src" | "alt" | StyleKey | "hidden";

/** "Heading" / "Text" / "Button" / "Image" / "Block" — the panel's eyebrow. */
export function kindLabel(kind: ElementKind): string {
  return { heading: "Heading", text: "Text", button: "Button", image: "Image", block: "Block" }[
    kind
  ];
}

export function changeFor(
  changes: readonly VisualChange[],
  selector: string,
): VisualChange | undefined {
  return changes.find((change) => change.selector === selector);
}

export function removeChange(changes: readonly VisualChange[], selector: string): VisualChange[] {
  return changes.filter((change) => change.selector !== selector);
}

/** A change id: short, unique within a variant, never derived from page content. */
export function newChangeId(random: () => number = Math.random): string {
  let id = "c";
  while (id.length < 11) id += Math.floor(random() * 36).toString(36);
  return id;
}

/**
 * Sets (or, with `undefined`, clears) one value of the change to `element`, following the
 * design's rules: a value equal to the original is no change, and a change that sets nothing is
 * removed. Changes keep their order; a new one is appended. Returns `changes` itself when nothing
 * would change, so callers can skip an undo step.
 */
export function editChange(
  changes: readonly VisualChange[],
  element: ElementDescriptor,
  key: EditKey,
  /** `hidden` takes `true` (or `undefined` to show the element again); every other key a string. */
  value: string | true | undefined,
  makeId: () => string = newChangeId,
): readonly VisualChange[] {
  const existing = changeFor(changes, element.selector);
  const original: VisualChange["original"] = existing
    ? existing.original
    : Object.fromEntries(
        (["text", "src", "alt", ...STYLE_KEYS] as const)
          .filter((k) => element.current[k] !== undefined)
          .map((k) => [k, element.current[k]]),
      );

  const set: VisualChange["set"] = { ...(existing?.set ?? {}) };
  const before = key === "hidden" ? undefined : original[key];
  const clears = value === undefined || value === (before ?? (key === "text" ? "" : undefined));
  if (clears) delete set[key];
  else if (key === "hidden") set.hidden = true;
  else if (typeof value === "string") set[key] = value;

  if (JSON.stringify(set) === JSON.stringify(existing?.set ?? {})) return changes;
  if (Object.keys(set).length === 0) return removeChange(changes, element.selector);

  if (existing) {
    return changes.map((change) => (change === existing ? { ...change, set } : change));
  }

  const fingerprint: VisualChange["fingerprint"] = { tag: element.fingerprint.tag };
  if (element.fingerprint.text !== undefined) fingerprint.text = element.fingerprint.text;
  if (element.fingerprint.src !== undefined) fingerprint.src = element.fingerprint.src;

  return [
    ...changes,
    {
      id: makeId(),
      selector: element.selector,
      kind: element.kind,
      label: element.label || kindLabel(element.kind),
      fingerprint,
      original,
      set,
    },
  ];
}

// --- Values -----------------------------------------------------------------------------------

/** A colour the SDK and the server both accept. */
export function isEditorColor(value: string): boolean {
  return HEX.test(value) || RGB.test(value);
}

/**
 * `rgb(31, 61, 43)` / `#1f3d2b` / `#abc` → `#1f3d2b`, for a colour input. Null for anything else,
 * and for a fully transparent colour (a button painted by its border has no background to show).
 */
export function toHexColor(css: string | undefined): string | null {
  if (!css) return null;
  const value = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return ("#" + [...value.slice(1)].map((c) => c + c).join("")).toLowerCase();
  }
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    value,
  );
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  const channels = [m[1], m[2], m[3]].map((c) => Math.min(255, Number(c)));
  return "#" + channels.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** An image URL the server will store: `https:` and at most 2,048 characters. */
export function isEditorImageUrl(value: string): boolean {
  if (value.length > EDITOR_MAX_SRC) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
