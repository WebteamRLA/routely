import type { NextRequest } from "next/server";

import type {
  ConfigResponse,
  DeviceType,
  ExperimentConfig,
  ExperimentVariantConfig,
  VisualChange,
} from "@routely/sdk/contract";
import { LEGACY_PROTOCOL_VERSION, SDK_PROTOCOL_VERSION } from "@routely/sdk/contract";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import type { ExperimentWithVariants } from "@/server/repositories/experiment.repository";
import * as websiteService from "@/server/services/website.service";
import { configRequestSchema } from "@/validation/tracking";

/**
 * Public experiment configuration for the tracking SDK.
 *
 *   GET /api/v1/config?siteId=rt_…&v=4
 *
 * `v=4` (what the current SDK sends) gets the v4 document: every ACTIVE experiment with its
 * `kind`, `devices`, `keepParams` and, for A/B tests, the visual `changes`. Anything else — an
 * installed v3 bundle sends no `v` — gets the v3 document, which omits A/B tests and
 * device-targeted experiments that an old bundle would mis-serve.
 *
 * Unauthenticated by necessity — it is called by a script running on a visitor's browser on
 * the customer's own site — and therefore deliberately narrow. It exposes exactly what the
 * SDK needs to decide what to do on a page, and nothing that identifies the account, the
 * website record, or any experiment that is not currently running.
 *
 * **Only ACTIVE experiments are published.** That is the mechanism behind the lifecycle
 * guarantees: a draft cannot affect a visitor because it never reaches the browser, and
 * pausing takes effect as soon as caches expire because the experiment simply stops being
 * listed. There is no separate "is this paused?" check on the client to get wrong.
 */

/** The Prisma adapter uses a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";

/**
 * How long a browser may reuse this document.
 *
 * Short, because it is the propagation delay for pausing an experiment: a visitor with a
 * cached config keeps the old configuration until it expires. `stale-while-revalidate` keeps
 * the request off the critical path while the refresh happens in the background.
 */
const TTL_SECONDS = 60;
const STALE_SECONDS = 300;

const CORS_HEADERS = {
  // The SDK runs on customer domains, which are arbitrary and not known in advance.
  // Safe here because the response is identical for every caller and depends on no cookie:
  // there is no session to ride, so a permissive origin grants nothing a direct fetch lacks.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
} as const;

function json(body: unknown, status: number, cacheable: boolean) {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": cacheable
        ? `public, max-age=${TTL_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`
        : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = configRequestSchema.safeParse({
    siteId: params.get("siteId") ?? "",
    v: params.get("v") ?? undefined,
  });

  if (!parsed.success) {
    // A malformed id is a broken installation, so say so — but do not cache the answer, in
    // case the snippet is corrected a moment later.
    return json({ error: "Invalid siteId" }, 400, false);
  }

  const { siteId } = parsed.data;
  const version =
    parsed.data.v >= SDK_PROTOCOL_VERSION ? SDK_PROTOCOL_VERSION : LEGACY_PROTOCOL_VERSION;

  const website = await websiteService.resolveWebsiteByPublicSiteId(siteId);

  // An unknown-but-well-formed id returns an empty configuration rather than 404. A deleted
  // website leaves its snippet installed on pages nobody will update, and those pages should
  // quietly do nothing instead of logging an error on every view. The SDK's behaviour is the
  // same either way: no experiments, no redirect.
  const experiments = website ? await experimentRepo.listActiveExperiments(website.id) : [];

  const body: ConfigResponse = {
    v: version,
    siteId,
    ttl: TTL_SECONDS,
    experiments: experiments.flatMap((experiment) => {
      const config = toExperimentConfig(experiment);
      if (!config) return [];
      if (version === SDK_PROTOCOL_VERSION) return [config];
      return toLegacyConfig(config);
    }),
  };

  // The document differs by `v`, which is part of the URL — so the cache key already separates
  // them and no `Vary` is needed.
  return json(body, 200, true);
}

/* ---------------------------------------------------------------------------------------------
 * Projection: database row → wire document
 * ------------------------------------------------------------------------------------------- */

const DEVICE_COUNT = 3;
const MAX_CHANGES = 50;
const ELEMENT_KINDS: ReadonlySet<string> = new Set(["heading", "text", "button", "image", "block"]);
const SET_KEYS = [
  "text",
  "backgroundColor",
  "src",
  "alt",
  "color",
  "fontSize",
  "fontWeight",
  "textAlign",
  "padding",
  "margin",
] as const;

/**
 * One ACTIVE experiment as a v4 `ExperimentConfig`, or null when the row cannot be served.
 *
 * Launch makes the null cases impossible (a missing control or goal URL, a split-URL variant
 * without a URL), but this is the last line before a browser acts on the data, so a row that
 * somehow lacks them is skipped rather than sent with a null in it.
 */
function toExperimentConfig(experiment: ExperimentWithVariants): ExperimentConfig | null {
  const { controlUrl, conversionUrl } = experiment;
  if (controlUrl === null || conversionUrl === null) return null;

  const kind = experiment.type === "AB_TEST" ? "ab_test" : "split_url";

  const variants: ExperimentVariantConfig[] = [];
  for (const variant of experiment.variants) {
    if (kind === "split_url") {
      if (variant.url === null) return null;
      variants.push({ id: variant.id, url: variant.url, weight: variant.weight });
    } else {
      variants.push({
        id: variant.id,
        weight: variant.weight,
        changes: projectChanges(variant.changes),
      });
    }
  }

  // "All three" is stored normalised to empty, but an unnormalised row must mean the same thing.
  const devices: DeviceType[] =
    experiment.targetDevices.length >= DEVICE_COUNT
      ? []
      : experiment.targetDevices.map((device) => device.toLowerCase() as DeviceType);

  return {
    id: experiment.id,
    kind,
    devices,
    keepParams: kind === "split_url" && experiment.keepQueryParams,
    control: { url: controlUrl, match: experiment.controlMatchType },
    controlWeight: experiment.controlWeight,
    variants,
    goal: { url: conversionUrl, match: experiment.conversionMatchType },
    trafficAllocation: experiment.trafficAllocation,
  };
}

/**
 * The v3 view of a v4 config: redirect-only, every-device. An A/B test or a device-targeted
 * experiment is **omitted** — a v3 bundle would read the first as a redirect to nowhere and show
 * the second to every device (see `LEGACY_PROTOCOL_VERSION` in the contract).
 */
function toLegacyConfig(config: ExperimentConfig): ExperimentConfig[] {
  if (config.kind !== "split_url" || (config.devices?.length ?? 0) > 0) return [];
  return [
    {
      id: config.id,
      control: config.control,
      controlWeight: config.controlWeight,
      variants: config.variants.map(({ id, url, weight }) => ({ id, url, weight })),
      goal: config.goal,
      trafficAllocation: config.trafficAllocation,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Stored `VisualChange[]` → the wire subset `{selector, kind, fingerprint:{tag}, set}`.
 *
 * Accepts the list itself or a `{ schemaVersion, changes }` envelope. Anything malformed is
 * dropped item by item — the SDK validates every value again before applying it, and a change it
 * cannot apply is skipped there too, so the cost of a bad item is that one change, never the page.
 * `id`, `label` and `original` are not sent: visitors do not need them.
 */
function projectChanges(stored: unknown): VisualChange[] {
  const list = Array.isArray(stored)
    ? stored
    : isRecord(stored) && Array.isArray(stored["changes"])
      ? stored["changes"]
      : [];

  const changes: VisualChange[] = [];
  for (const item of list.slice(0, MAX_CHANGES)) {
    if (!isRecord(item)) continue;
    const { selector, kind, fingerprint, set } = item;
    if (typeof selector !== "string" || !selector || typeof kind !== "string") continue;
    if (!ELEMENT_KINDS.has(kind) || !isRecord(set)) continue;

    const values: VisualChange["set"] = {};
    for (const key of SET_KEYS) {
      const value = set[key];
      if (typeof value === "string") values[key] = value;
    }
    if (set["hidden"] === true) values.hidden = true;
    if (Object.keys(values).length === 0) continue;

    const change: VisualChange = { selector, kind: kind as VisualChange["kind"], set: values };
    if (isRecord(fingerprint) && typeof fingerprint["tag"] === "string") {
      change.fingerprint = { tag: fingerprint["tag"] };
    }
    changes.push(change);
  }
  return changes;
}
