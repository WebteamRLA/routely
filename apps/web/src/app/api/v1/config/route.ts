import type { NextRequest } from "next/server";

import type {
  ConfigResponse,
  ExperimentConfig,
  LegacyConfigResponse,
  LegacyExperimentConfig,
} from "@routely/sdk/contract";
import { LEGACY_PROTOCOL_VERSION, SDK_PROTOCOL_VERSION } from "@routely/sdk/contract";
import { countryFromHeaders, toV3Experiment, toV4Experiment, usesGeo } from "@/lib/sdk-config";
import * as configRepo from "@/server/repositories/config.repository";
import * as websiteService from "@/server/services/website.service";
import { configRequestSchema } from "@/validation/tracking";

/**
 * Public experiment configuration for the tracking SDK.
 *
 *   GET /api/v1/config?siteId=rt_…
 *
 * Unauthenticated by necessity — it is called by a script running on a visitor's browser on
 * the customer's own site — and therefore deliberately narrow. It exposes exactly what the
 * SDK needs to decide what to do on a page, and nothing that identifies the account, the
 * website record, or any experiment that is not currently running.
 *
 * **Only ACTIVE experiments are published.** That is the mechanism behind the lifecycle
 * guarantees: a draft cannot affect a visitor because it never reaches the browser, and
 * pausing takes effect as soon as caches expire because the experiment simply stops being
 * listed. There is no separate "is this paused?" check on the client to get wrong. The two
 * additions in protocol v4 are equally explicit: a completed Split URL test that keeps its
 * winner is published as a `locked` redirect, and a preview link (`&preview=<id>`) adds that one
 * experiment whatever its status — ids are unguessable, and a preview is never assigned or
 * tracked.
 *
 * **Protocol.** `?v=4` gets the v4 shape. Anything else gets v3, because bundles fetched from
 * the immutable `/sdk/v1/` path may run from browser caches for a year and do not send `v`.
 *
 * **Location targeting is resolved here**, from the platform's geo header
 * (`x-vercel-ip-country`, else `cf-ipcountry`): an experiment the visitor's country fails is
 * left out. An unknown country is included — see `passesGeo`. A response that depends on the
 * country is marked `private` so no shared cache serves it to a visitor from elsewhere.
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

type Caching = "public" | "private" | "none";

function json(body: unknown, status: number, caching: Caching) {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control":
        caching === "none"
          ? "no-store"
          : `${caching}, max-age=${TTL_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      Vary: "X-Vercel-IP-Country, CF-IPCountry",
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
    preview: params.get("preview") ?? undefined,
  });

  if (!parsed.success) {
    // A malformed id is a broken installation, so say so — but do not cache the answer, in
    // case the snippet is corrected a moment later.
    return json({ error: "Invalid siteId" }, 400, "none");
  }

  const { siteId, preview } = parsed.data;
  const website = await websiteService.resolveWebsiteByPublicSiteId(siteId);

  // An unknown-but-well-formed id returns an empty configuration rather than 404. A deleted
  // website leaves its snippet installed on pages nobody will update, and those pages should
  // quietly do nothing instead of logging an error on every view.
  const rows = website ? await configRepo.listConfigExperiments(website.id) : [];

  if (parsed.data.v !== String(SDK_PROTOCOL_VERSION)) {
    const body: LegacyConfigResponse = {
      v: LEGACY_PROTOCOL_VERSION,
      siteId,
      ttl: TTL_SECONDS,
      experiments: rows
        .map(toV3Experiment)
        .filter((experiment): experiment is LegacyExperimentConfig => experiment !== null),
    };
    return json(body, 200, "public");
  }

  const country = countryFromHeaders(request.headers);
  const experiments = rows
    .map((row) => toV4Experiment(row, country))
    .filter((experiment): experiment is ExperimentConfig => experiment !== null);

  if (website && preview) {
    const row = await configRepo.findPreviewExperiment(preview, website.id);
    const previewed = row ? toV4Experiment(row, null, { preview: true }) : null;
    if (previewed) experiments.push(previewed);
  }

  const body: ConfigResponse = {
    v: SDK_PROTOCOL_VERSION,
    siteId,
    ttl: TTL_SECONDS,
    experiments,
  };

  return json(body, 200, preview ? "none" : rows.some(usesGeo) ? "private" : "public");
}
