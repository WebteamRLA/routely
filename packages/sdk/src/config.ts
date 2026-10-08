import type { ArmConfig, ConfigResponse, ExperimentConfig, TargetingConfig } from "./contract";
import { SDK_PROTOCOL_VERSION } from "./contract";
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

  return (
    candidate.v === SDK_PROTOCOL_VERSION &&
    typeof candidate.siteId === "string" &&
    Array.isArray(candidate.experiments) &&
    candidate.experiments.every(isExperimentConfig)
  );
}

function isTargetingConfig(value: unknown): value is TargetingConfig {
  const t = value as Partial<TargetingConfig> | null;
  return (
    typeof t === "object" &&
    t !== null &&
    typeof t.match === "string" &&
    typeof t.pattern === "string" &&
    Array.isArray(t.devices) &&
    Array.isArray(t.conditions)
  );
}

function isArmConfig(value: unknown, type: unknown): value is ArmConfig {
  const arm = value as Partial<ArmConfig> | null;
  return (
    typeof arm === "object" &&
    arm !== null &&
    typeof arm.position === "number" &&
    typeof arm.weight === "number" &&
    (arm.variantId === null || typeof arm.variantId === "string") &&
    // A redirect arm without a URL could not be followed; an A/B arm's changes must be a list.
    (type === "redirect" ? typeof arm.url === "string" : Array.isArray(arm.changes ?? []))
  );
}

function isExperimentConfig(value: unknown): value is ExperimentConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof ExperimentConfig | "arms" | "target", unknown>>;

  if (typeof candidate.id !== "string" || !isTargetingConfig(candidate.targeting)) return false;
  if (candidate.locked === true) return typeof candidate.target === "string";

  return (
    (candidate.type === "redirect" || candidate.type === "ab") &&
    Array.isArray(candidate.arms) &&
    candidate.arms.length > 0 &&
    candidate.arms.every((arm) => isArmConfig(arm, candidate.type))
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

/**
 * `v` asks for protocol v4 — without it the endpoint answers in v3 for the bundles cached before
 * v4 existed. `preview` additionally returns that experiment whatever its status, for the
 * preview link; such a response is never cached.
 */
export function configUrl(apiBase: string, siteId: string, preview?: string): string {
  return (
    `${apiBase}/api/v1/config?v=${SDK_PROTOCOL_VERSION}&siteId=${encodeURIComponent(siteId)}` +
    (preview ? `&preview=${encodeURIComponent(preview)}` : "")
  );
}

/**
 * Returns the site's configuration, from cache when it is fresh, otherwise from the network.
 * Resolves to `null` on any failure, which callers treat as "no experiments".
 */
export async function loadConfig(
  apiBase: string,
  siteId: string,
  timeoutMs?: number,
  preview?: string,
): Promise<ConfigResponse | null> {
  // A preview reads and writes no cache: it must see the experiment as it is now, and must not
  // leave a draft's configuration behind for the visitor's next ordinary page load.
  const store = preview ? null : getSessionStorage();

  const cached = readCachedConfig(siteId, store);
  if (cached) return cached;

  const fetched = await getJson<unknown>(configUrl(apiBase, siteId, preview), timeoutMs);
  if (!isConfigResponse(fetched)) return null;

  writeCachedConfig(siteId, fetched, store);
  return fetched;
}
