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
 * v2: `variantUrl`/`variantSplit` replaced by `variants` (one or more redirect targets).
 *
 * v3: explicit per-arm weights — `controlWeight` plus a `weight` on every variant.
 *
 * v4: two experiment types (`redirect` | `ab`), arms as one positioned list (control is
 * position 0), page/audience targeting and coverage, completed experiments that keep
 * redirecting to their winner (`locked`), and two site-level event types — `page` (every page
 * view, whether or not an experiment runs there) and `track` (a custom event). Conversions are
 * no longer reported by the browser: the server derives them from `page` and `track` events
 * against the visitor's existing assignments, so a goal can be a URL, a page-visit metric or a
 * custom event without the browser knowing which.
 *
 * The server still answers v3 bundles — a bundle fetched from the immutable `/sdk/v1/` path
 * can sit in a browser cache for a year — see `LEGACY_PROTOCOL_VERSION`.
 */
export const SDK_PROTOCOL_VERSION = 4;

/** The previous protocol, still served to bundles that do not ask for v4. */
export const LEGACY_PROTOCOL_VERSION = 3;

/** How a configured URL is compared against the visitor's current URL (legacy rules). */
export type UrlMatchType = "EXACT" | "PREFIX";

/**
 * A page rule's match mode.
 *
 * The lowercase modes are the targeting step's (`lib/targeting.ts` `matches`). The uppercase
 * ones are the pre-targeting rules — an experiment with no stored targeting keeps exactly the
 * normalised-URL semantics it was created with, including PREFIX's path boundary.
 */
export type PageMatchMode = "exact" | "contains" | "starts" | "wildcard" | "regex" | UrlMatchType;

export type DeviceKind = "desktop" | "tablet" | "mobile";

export interface ConditionConfig {
  field: "query" | "utm_source" | "utm_medium" | "utm_campaign" | "referrer";
  /** Parameter name, for `field: "query"`. */
  key: string;
  op: "equals" | "not" | "contains" | "exists";
  value: string;
}

/**
 * Who and where an experiment runs, as evaluated in the browser.
 *
 * Location is not here: countries are resolved by the config endpoint from the request's geo
 * headers, which the browser cannot know — an experiment the visitor's country fails is simply
 * left out of the response.
 */
export interface TargetingConfig {
  match: PageMatchMode;
  pattern: string;
  audience: "all" | "new" | "returning";
  devices: DeviceKind[];
  logic: "all" | "any";
  conditions: ConditionConfig[];
}

/** One element change on an A/B arm. */
export interface ChangeConfig {
  selector: string;
  prop: "text" | "bg" | "image";
  value: string;
}

/** One arm. Position 0 is control (`variantId: null`). */
export interface ArmConfig {
  position: number;
  variantId: string | null;
  /** Relative share of included traffic. `0` parks the arm. */
  weight: number;
  /** Redirect tests: where this arm's visitors are sent (control's is its own page). */
  url?: string;
  /** A/B tests: what to change on the page. Empty for control. */
  changes?: ChangeConfig[];
}

/** A running experiment. */
export interface LiveExperimentConfig {
  id: string;
  type: "redirect" | "ab";
  locked?: false;
  targeting: TargetingConfig;
  /** Percentage of targeted visitors entered at all, 1–100. */
  coverage: number;
  arms: ArmConfig[];
  /** Set only on an experiment served for `?routely_preview=`; never assigned or tracked. */
  preview?: boolean;
}

/**
 * A completed Split URL test that keeps sending its traffic to the winner. The SDK redirects
 * to `target` without assigning or reporting anything — the experiment is over.
 */
export interface LockedExperimentConfig {
  id: string;
  type: "redirect";
  locked: true;
  targeting: TargetingConfig;
  target: string;
}

export type ExperimentConfig = LiveExperimentConfig | LockedExperimentConfig;

/** Response of `GET /api/v1/config?siteId=…&v=4`. */
export interface ConfigResponse {
  v: typeof SDK_PROTOCOL_VERSION;
  siteId: string;
  experiments: ExperimentConfig[];
  /** Seconds the browser may reuse this document before refetching. */
  ttl: number;
}

/**
 * Kinds of event the SDK reports.
 *
 * The first four are experiment-scoped and are also the values of the `EventType` enum in the
 * Prisma schema, stored verbatim. `page` and `track` are site-level: they are matched against
 * the project's metrics and the visitor's goals by the server, and are not stored as `Event`
 * rows themselves. A v4 bundle never sends `conversion`.
 */
export type ExperimentEventType = "page_view" | "assignment" | "time_on_page" | "conversion";
export type EventType = ExperimentEventType | "page" | "track";

/** Query parameters used to hand a visitor's identity across an origin boundary. */
export const HANDOFF_PARAMS = {
  visitorId: "_rt_vid",
  experimentId: "_rt_e",
  /** The variant id the visitor was sent to. Never present for control. */
  variant: "_rt_v",
} as const;

/** `?routely_preview=<experimentId>:<position>` forces an arm, applies it, and reports nothing. */
export const PREVIEW_PARAM = "routely_preview";

/** An experiment-scoped event. */
export interface ExperimentEvent {
  type: ExperimentEventType;
  experimentId: string;
  /** The variant the visitor is in, or `null` for control. */
  variantId: string | null;
  url: string;
  /** Accumulated foreground time in milliseconds. Only present on `time_on_page`. */
  durationMs?: number;
  /** Client timestamp in epoch milliseconds; clamped server-side. */
  ts: number;
}

/** A page view on any page of the site. */
export interface PageEvent {
  type: "page";
  url: string;
  ts: number;
}

/** A custom event: `routely.track(key)`. */
export interface TrackEvent {
  type: "track";
  key: string;
  url: string;
  ts: number;
}

export type TrackedEvent = ExperimentEvent | PageEvent | TrackEvent;

/** Body of `POST /api/v1/events`. */
export interface EventBatch {
  v: typeof SDK_PROTOCOL_VERSION;
  siteId: string;
  visitorId: string;
  events: TrackedEvent[];
}

// ---------------------------------------------------------------------------
// Protocol v3 — still served and accepted for bundles cached before v4 shipped.
// ---------------------------------------------------------------------------

export interface LegacyExperimentConfig {
  id: string;
  control: { url: string; match: UrlMatchType };
  controlWeight: number;
  variants: { id: string; url: string; weight: number }[];
  goal: { url: string; match: UrlMatchType };
  trafficAllocation: number;
}

export interface LegacyConfigResponse {
  v: typeof LEGACY_PROTOCOL_VERSION;
  siteId: string;
  experiments: LegacyExperimentConfig[];
  ttl: number;
}
