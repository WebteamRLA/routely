import type { ConfigResponse, ExperimentConfig, VisualChange } from "./contract";
import { LEGACY_PROTOCOL_VERSION, SDK_PROTOCOL_VERSION } from "./contract";
import { type KeyValueStore, getSessionStorage } from "./env";
import { getJson } from "./transport";

/**
 * Experiment configuration for a website.
 *
 * Fetched from the public endpoint and cached in `sessionStorage`, so a visitor moving through
 * several pages makes one request rather than one per page. The cache is keyed by site id and
 * carries its own expiry, taken from the server's `ttl` — the server decides how stale a
 * browser may be, because it is the side that knows when an experiment was paused.
 */

const CACHE_PREFIX = "routely_cfg_";

/** Ceiling on a server-supplied TTL, so a bad value cannot pin a stale config for a session. */
const MAX_TTL_SECONDS = 600;

interface CachedConfig {
  /** Epoch milliseconds after which this entry must be refetched. */
  expiresAt: number;
  config: ConfigResponse;
}

/**
 * Confirms a payload is the shape this SDK understands before any of it is used.
 *
 * The response comes from the network, and an installation may outlive several deployments of
 * the API. Checking the protocol version and the field shapes here means a future server that
 * sends something new is ignored rather than half-interpreted by an old bundle.
 */
export function isConfigResponse(value: unknown): value is ConfigResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ConfigResponse>;

  // v3 is still understood: it is a v4 document with every new field at its default, which is
  // what an API that has not been upgraded keeps sending.
  return (
    (candidate.v === SDK_PROTOCOL_VERSION || candidate.v === LEGACY_PROTOCOL_VERSION) &&
    typeof candidate.siteId === "string" &&
    Array.isArray(candidate.experiments) &&
    candidate.experiments.every(isExperimentConfig)
  );
}

const DEVICES = ["desktop", "mobile", "tablet"];

/**
 * Field shapes only. Values inside a visual change (a colour, an image URL) are validated where
 * they are applied, so one bad value costs that change rather than the whole configuration.
 */
function isExperimentConfig(value: unknown): value is ExperimentConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ExperimentConfig>;
  const kind = candidate.kind ?? "split_url";
  const devices = candidate.devices;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.controlWeight === "number" &&
    (kind === "split_url" || kind === "ab_test") &&
    (devices === undefined ||
      (Array.isArray(devices) && devices.every((device) => DEVICES.indexOf(device) >= 0))) &&
    (candidate.keepParams === undefined || typeof candidate.keepParams === "boolean") &&
    Array.isArray(candidate.variants) &&
    candidate.variants.length > 0 &&
    candidate.variants.every(
      (variant) =>
        typeof variant === "object" &&
        variant !== null &&
        typeof variant.id === "string" &&
        typeof variant.weight === "number" &&
        // A split-URL arm without a target could only ever redirect nowhere; an A/B arm is a
        // list of changes, which may be empty (it then behaves exactly like control).
        (kind === "split_url"
          ? typeof variant.url === "string"
          : variant.changes === undefined ||
            (Array.isArray(variant.changes) && variant.changes.every(isVisualChange))),
    ) &&
    typeof candidate.control?.url === "string" &&
    typeof candidate.goal?.url === "string"
  );
}

function isVisualChange(value: unknown): boolean {
  const change = value as VisualChange | null;
  return (
    typeof change === "object" &&
    change !== null &&
    typeof change.selector === "string" &&
    typeof change.set === "object" &&
    change.set !== null
  );
}

export function cacheKey(siteId: string): string {
  return CACHE_PREFIX + siteId;
}

/** Reads a cached config, ignoring anything expired, malformed, or from another protocol. */
export function readCachedConfig(
  siteId: string,
  store: KeyValueStore | null,
  now: number = Date.now(),
): ConfigResponse | null {
  if (!store) return null;

  try {
    const raw = store.getItem(cacheKey(siteId));
    if (!raw) return null;

    const entry = JSON.parse(raw) as Partial<CachedConfig>;
    if (typeof entry.expiresAt !== "number" || entry.expiresAt <= now) return null;
    if (!isConfigResponse(entry.config)) return null;

    return entry.config;
  } catch {
    return null;
  }
}

export function writeCachedConfig(
  siteId: string,
  config: ConfigResponse,
  store: KeyValueStore | null,
  now: number = Date.now(),
): void {
  if (!store) return;

  const ttl = Math.min(Math.max(config.ttl ?? 0, 0), MAX_TTL_SECONDS);

  try {
    const entry: CachedConfig = { expiresAt: now + ttl * 1000, config };
    store.setItem(cacheKey(siteId), JSON.stringify(entry));
  } catch {
    // A full or unavailable session store only costs an extra request per page.
  }
}

export function configUrl(apiBase: string, siteId: string): string {
  // `v` lets the server keep answering installed older bundles with a shape they understand.
  return `${apiBase}/api/v1/config?siteId=${encodeURIComponent(siteId)}&v=${SDK_PROTOCOL_VERSION}`;
}

/**
 * Returns the site's configuration, from cache when it is fresh, otherwise from the network.
 * Resolves to `null` on any failure, which callers treat as "no experiments".
 */
export async function loadConfig(
  apiBase: string,
  siteId: string,
  timeoutMs?: number,
): Promise<ConfigResponse | null> {
  const store = getSessionStorage();

  const cached = readCachedConfig(siteId, store);
  if (cached) return cached;

  const fetched = await getJson<unknown>(configUrl(apiBase, siteId), timeoutMs);
  if (!isConfigResponse(fetched)) return null;

  writeCachedConfig(siteId, fetched, store);
  return fetched;
}
