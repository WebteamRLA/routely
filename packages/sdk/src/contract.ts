/**
 * Wire contract shared by the tracking SDK (browser) and the ingestion API (server).
 *
 * This module is intentionally **type-only plus frozen constants**: it is imported by both
 * `@routely/sdk` and `@routely/web`, so it must never pull in runtime dependencies and must
 * never grow browser- or server-specific code. Changing anything here is a breaking change
 * for already-installed snippets — bump `SDK_PROTOCOL_VERSION` instead of mutating a shape.
 */

/**
 * Incremented when the config/event payload shape changes incompatibly.
 *
 * v2: `variantUrl`/`variantSplit` (exactly one variant, a stored split) replaced by `variants`
 * (one or more redirect targets) and an implicit equal split derived from their count. The
 * `VariantKey` literal `"CONTROL" | "VARIANT"` became `variantId: string | null` — `null` is
 * control, a variant's id is itself now a meaningful identifier rather than a fixed label.
 *
 * v3: the implicit equal split became explicit per-arm weights — `controlWeight` plus a
 * `weight` on every variant. A v2 bundle reading a v3 config would split evenly and silently
 * ignore a configured distribution, which is exactly the kind of quiet wrongness the version
 * check exists to prevent.
 */
export const SDK_PROTOCOL_VERSION = 4;

/**
 * v4: experiments gain a `kind`. A `split_url` experiment redirects exactly as in v3; an
 * `ab_test` experiment keeps the visitor on the tested page and applies visual `changes` per
 * arm. Every experiment also gains `devices` (device targeting) and `keepParams` (carry the
 * visitor's own query string and fragment to a split-URL variant).
 *
 * The SDK still accepts a v3 document, read as a v4 one with every new field at its default:
 * `kind: "split_url"`, `devices: []` (all devices), `keepParams: false`. That is exactly what a
 * v3 experiment meant, so an API that has not been upgraded keeps working unchanged.
 *
 * The SDK requests `?v=4`. A server must answer an older caller (no `v`, or `v=3`) with a v3
 * document that **omits** every `ab_test` and every device-targeted experiment: a v3 bundle
 * would read an A/B test as a redirect to a variant with no URL, and would show a
 * device-targeted test to every device.
 */
export const LEGACY_PROTOCOL_VERSION = 3;

/** Every `v` a current API should accept on an ingestion batch (`/events`, `/hit`). The batch
 * shape did not change between them, so an installed v3 bundle's events remain valid. */
export const ACCEPTED_PROTOCOL_VERSIONS = [LEGACY_PROTOCOL_VERSION, SDK_PROTOCOL_VERSION] as const;

/** How a configured URL is compared against the visitor's current URL. */
export type UrlMatchType = "EXACT" | "PREFIX";

/**
 * Kinds of event the SDK reports back to the ingestion endpoint.
 *
 * These strings are also the values of the `EventType` enum in the Prisma schema, so an
 * ingested value is stored verbatim with no translation table between wire and column.
 */
export type EventType = "page_view" | "assignment" | "time_on_page" | "conversion";

/** Query parameters used to hand a visitor's identity across an origin boundary. */
export const HANDOFF_PARAMS = {
  visitorId: "_rt_vid",
  experimentId: "_rt_e",
  /** The variant id the visitor was sent to. Never present for control — control never
   * redirects, so it never needs to hand its arm across an origin boundary. */
  variant: "_rt_v",
} as const;

/** What an experiment does to a visitor in a variant arm. */
export type ExperimentKind = "split_url" | "ab_test";

/** Device classes an experiment can be limited to. Decided in the browser (see `device.ts`). */
export type DeviceType = "desktop" | "mobile" | "tablet";

/** The kind of element a visual change targets, as classified by the editor. */
/** `block`: any other element — a section, a group, a list — for its styles and visibility. */
export type ElementKind = "heading" | "text" | "button" | "image" | "block";

/**
 * The values a visual change sets. At least one is present. Each is validated again in the
 * browser before use, and an invalid value is skipped rather than applied.
 *
 * - `text` — plain text, applied with `textContent` (or `value` on an `<input>`), never as HTML.
 * - `backgroundColor` — `#rgb`, `#rrggbb`, `rgb(…)` or `rgba(…)`.
 * - `src` — an absolute `http:`/`https:` image URL.
 * - `alt` — plain text.
 * - `color` — the text colour, in the same forms as `backgroundColor`.
 * - `fontSize`, `fontWeight`, `textAlign`, `padding`, `margin` — CSS values made only of letters,
 *   digits, spaces, `.`, `%`, `#` and `-` (`24px`, `700`, `center`, `16px 24px`, `0 auto`); the
 *   server is stricter. Each is set as one property, so it can never reach another.
 * - `hidden` — `true` hides the element in this variant.
 *
 * Every style is applied with `!important`, so the page's own stylesheet cannot override it.
 */
export interface VisualChangeSet {
  text?: string;
  backgroundColor?: string;
  src?: string;
  alt?: string;
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  textAlign?: string;
  padding?: string;
  margin?: string;
  hidden?: boolean;
}

/**
 * One change to one element, schema version 1.
 *
 * This is the subset of the stored `VisualChange` (spec §4.4) the browser needs. A server may
 * send the stored object whole — `id`, `label` and `original` are ignored — but should project it
 * to these fields: the original text is not needed by visitors and only adds bytes.
 */
export interface VisualChange {
  /** A CSS selector produced by the editor: `#id`, or a stable-id ancestor plus a
   * `tag:nth-of-type(n)` chain. */
  selector: string;
  kind: ElementKind;
  /** The element the change was authored against. A selector that now resolves to a different
   * tag has drifted, and the change is not applied to it. */
  fingerprint?: { tag?: string };
  set: VisualChangeSet;
}

/** One arm other than control. */
export interface ExperimentVariantConfig {
  id: string;
  /** The redirect target. Required for `split_url`; absent (or null) for `ab_test`. */
  url?: string | null;
  /** The visual changes for this arm. `ab_test` only; at most 50. */
  changes?: VisualChange[];
  /** This arm's share of the included traffic, relative to `controlWeight` and the other
   * variants' weights. `0` parks the arm — it receives no new visitors. */
  weight: number;
}

/** A single active experiment as published to the browser. */
export interface ExperimentConfig {
  id: string;
  control: { url: string; match: UrlMatchType };
  /** Control's share of the included traffic, relative to each variant's `weight`. */
  controlWeight: number;
  /** One or more redirect targets. */
  variants: ExperimentVariantConfig[];
  goal: { url: string; match: UrlMatchType };
  /**
   * Percentage of visitors on the control page entered into this experiment at all, 1–100.
   * Checked before the arm is drawn: a visitor excluded here is never assigned one. Kept
   * separate from the weights, which only decide *which* arm an included visitor lands on.
   */
  trafficAllocation: number;
  /** v4. Defaults to `"split_url"` when absent (a v3 document). */
  kind?: ExperimentKind;
  /** v4. The device classes included; empty or absent means every device. */
  devices?: DeviceType[];
  /** v4, `split_url` only. Carry the visitor's own query parameters (the target's own keys win)
   * and fragment onto the variant URL. Defaults to `false`. */
  keepParams?: boolean;
}

/** Response of `GET /api/v1/config?siteId=…&v=4`. */
export interface ConfigResponse {
  v: typeof SDK_PROTOCOL_VERSION | typeof LEGACY_PROTOCOL_VERSION;
  siteId: string;
  experiments: ExperimentConfig[];
  /** Seconds the browser may reuse this document before refetching. */
  ttl: number;
}

/** A single event in an ingestion batch. */
export interface TrackedEvent {
  experimentId: string;
  /** The variant the visitor is in, or `null` for control. */
  variantId: string | null;
  type: EventType;
  url: string;
  /** Accumulated foreground time in milliseconds. Only present on `time_on_page`. */
  durationMs?: number;
  /** Client timestamp in epoch milliseconds; clamped server-side. */
  ts: number;
}

/** Body of `POST /api/v1/events`. */
export interface EventBatch {
  v: typeof SDK_PROTOCOL_VERSION;
  siteId: string;
  visitorId: string;
  events: TrackedEvent[];
}

/**
 * Body of `POST /api/v1/assign`, sent as `text/plain`: a visitor with **no stored arm** asking
 * which arm they are in. The server chooses — it alone sees every visitor's assignment, which
 * balancing needs — and records it. The request names no arm.
 */
export interface AssignRequest {
  v: typeof SDK_PROTOCOL_VERSION;
  siteId: string;
  visitorId: string;
  experimentId: string;
}

/**
 * A `200` answer to `AssignRequest`: the visitor's arm, `null` for control. Any other answer —
 * `204`, an error, a timeout — means "not entered on this page load", and the SDK leaves the page
 * alone and asks again on the next one.
 */
export interface AssignResponse {
  variantId: string | null;
}

/**
 * Body of `POST /api/v1/hit` — one site-wide page hit, independent of any experiment.
 *
 * Sent with `sendBeacon` as `text/plain` (a CORS-simple request, no preflight) at most once per
 * normalised URL per UTC day per browser. `url` is normalised by the SDK and must be normalised
 * again by the server. `ts` is client epoch milliseconds and must be clamped.
 */
export interface PageHit {
  v: typeof SDK_PROTOCOL_VERSION;
  siteId: string;
  anonymousId: string;
  url: string;
  ts: number;
}

/* -------------------------------------------------------------------------------------------
 * Visual editor bridge — postMessage protocol between the Routely app and a customer's page.
 *
 *  1. The app opens the customer's page with `#_rt_edit=<token>` in an iframe, or in a popup
 *     (`window.open`, **without** `noopener`) when the site forbids framing.
 *  2. The installed SDK sees the token, does nothing else (no hit, no config, no assignment, no
 *     events), reveals the page, and posts `hello` to `window.parent` (framed) or
 *     `window.opener` (popup) with `targetOrigin` = the app origin, so the browser delivers it
 *     to the Routely app and to nothing else. It repeats `hello` for a few seconds until
 *     answered.
 *  3. The app checks `event.origin` is the origin of the URL it opened and `event.source` is
 *     that frame/popup, verifies the token (WP7: HMAC, ≤ 30 min), and replies `init` with the
 *     same token, `targetOrigin` = that page origin.
 *  4. The SDK accepts `init` only when `event.origin` is the app origin, `event.source` is the
 *     window it said hello to, and the token equals the one in its own URL. Only then does it
 *     load `<app>/sdk/v1/editor-agent.js`. Without that handshake the agent never loads.
 *  5. The agent posts `ready`, then `hover`/`select` as the user points and clicks, and answers
 *     every `preview` with `applied`. Every message it receives is checked the same way as
 *     `init`; every message it sends is addressed to the app origin and carries the token.
 *
 * The token only lets the editor open. It grants no data access: saving goes through the app's
 * authenticated server action, never through the page.
 * ------------------------------------------------------------------------------------------- */

/** Version of the editor message protocol (independent of `SDK_PROTOCOL_VERSION`). */
export const EDITOR_PROTOCOL_VERSION = 1;

/** The URL fragment key that asks the SDK to enter editor mode. */
export const EDITOR_HASH_PARAM = "_rt_edit";

/** What the agent reports about an element the user pointed at or clicked. */
export interface ElementDescriptor {
  /** Selector to store with a change. Verified to resolve back to this element. */
  selector: string;
  kind: ElementKind;
  /** Auto-generated, e.g. "Heading · Gear up for fall". */
  label: string;
  fingerprint: { tag: string; text?: string; src?: string };
  /** Current values, used as the change's `original`. */
  current: VisualChangeSet;
  /** False when the element holds more than text (an icon, nested blocks): replacing its text
   * would remove them, so the editor should not offer a text change. */
  textEditable: boolean;
  /** The element's ancestors, nearest first (at most 5, `body` excluded), as short labels —
   * "Section", "Group", "List" — for a breadcrumb; `routely:select-parent` climbs them. */
  crumbs?: string[];
}

/** Messages the page (SDK, then agent) sends to the app. */
export type EditorPageMessage =
  | { type: "routely:hello"; v: typeof EDITOR_PROTOCOL_VERSION; token: string; url: string }
  | { type: "routely:ready"; v: typeof EDITOR_PROTOCOL_VERSION; token: string; url: string }
  | { type: "routely:hover"; token: string; element: ElementDescriptor | null }
  | { type: "routely:select"; token: string; element: ElementDescriptor }
  | {
      type: "routely:applied";
      token: string;
      /** One entry per change in the last `preview`, in order. `false` = selector not found,
       * drifted, or a value that failed validation. */
      results: boolean[];
    }
  | { type: "routely:error"; token: string; code: "agent_load_failed" };

/** Messages the app sends to the page. */
export type EditorAppMessage =
  | { type: "routely:init"; v: typeof EDITOR_PROTOCOL_VERSION; token: string }
  /** The full change set to preview. Replaces the previous one: the page is restored to its
   * original state first, so an empty list shows the original page. */
  | { type: "routely:preview"; token: string; changes: VisualChange[] }
  /** `edit`: hover outlines and click-to-select. `preview`: neither (read-only versions). */
  | { type: "routely:mode"; token: string; mode: "edit" | "preview" }
  /** Outline an element from the changes list, or clear the selection with `null`. */
  | { type: "routely:highlight"; token: string; selector: string | null }
  /** Select the selected element's `depth`-th ancestor (1 = its parent); answered with `select`. */
  | { type: "routely:select-parent"; token: string; depth: number };
