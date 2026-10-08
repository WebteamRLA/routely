import "server-only";

import { env } from "@/env";
import type { CdnOverview } from "@/lib/view-models";
import { notFound } from "@/server/errors";
import * as websiteRepo from "@/server/repositories/website.repository";
import { requireProject } from "@/server/services/website.service";

/**
 * CDN delivery panel — a SERVICE SEAM.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────┐
 * │ There is NO CDN integration. The SDK is served by this app (`/sdk.js`), or from         │
 * │ `NEXT_PUBLIC_SDK_URL` if one is configured. Every statistic below is a PLACEHOLDER and  │
 * │ is flagged `placeholder: true` so the UI labels it as such. "Purge" only records the    │
 * │ time it was pressed (`Website.cdnPurgedAt`); it purges nothing.                         │
 * └──────────────────────────────────────────────────────────────────────────────────────┘
 */

export async function getCdnOverview(actorUserId: string, projectId: string): Promise<CdnOverview> {
  const project = await requireProject(actorUserId, projectId);
  return {
    placeholder: true,
    provider: "Not connected (placeholder)",
    sdkUrl: env.SDK_URL,
    stats: [
      { label: "Edge hit ratio", value: "—", placeholder: true },
      { label: "Median script latency", value: "—", placeholder: true },
      { label: "Requests · 24h", value: "—", placeholder: true },
    ],
    staticRules: [
      // The real Cache-Control values (next.config.ts, api/v1/config), not the prototype's.
      { asset: "Routely script (sdk.js)", ttl: "5 min" },
      { asset: "Experiment configuration", ttl: "60 s" },
      { asset: "Variant CSS & images", ttl: "24 h" },
      { asset: "Campaign page assets", ttl: "24 h" },
      { asset: "Fonts", ttl: "7 days" },
    ],
    dynamicRules: [
      "Visitor → variant assignment",
      "Event & conversion ingestion",
      "Preview / QA overrides",
    ],
    lastPurgedAt: project.cdnPurgedAt?.toISOString() ?? null,
  };
}

/** Records a purge request (placeholder — nothing is purged). Returns the recorded time. */
export async function purgeCdn(actorUserId: string, projectId: string): Promise<string> {
  const at = new Date();
  const result = await websiteRepo.updateWebsite(projectId, actorUserId, { cdnPurgedAt: at });
  if (result.count === 0) throw notFound("That project does not exist.");
  return at.toISOString();
}
