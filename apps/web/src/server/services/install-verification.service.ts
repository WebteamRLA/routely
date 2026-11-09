import "server-only";

import { createHash } from "node:crypto";

import { type VerifyOutcome, readServerCheck } from "@/lib/install-verification";
import { can, rolesWith } from "@/lib/permissions";
import { isSameSite } from "@/lib/url";
import { forbidden, notFound, rateLimited, validationFailed } from "@/server/errors";
import { rateLimit } from "@/server/http/rate-limit";
import * as verificationRepo from "@/server/repositories/install-verification.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { inspectPage } from "@/server/services/pixel.service";
import { parseOrThrow } from "@/server/validate";
import { installCheckSchema, verifySignalSchema } from "@/validation/custom-event";

/**
 * The install check, and the SDK's signal from the browser-run check it replaced.
 *
 * The dialogs ask `checkInstall`, which reads the page and any published GTM container on the
 * server. `recordVerifySignal` still answers `/api/v1/verify` for SDKs that carry `verify.ts`, but
 * nothing issues a token any more (2026-11-09), so it finds no run and records nothing.
 */

/** Per user, as the pixel check: each run fetches the page (twice past a cache) and its containers. */
const CHECK_RATE_LIMIT = 10;
const CHECK_RATE_WINDOW_MS = 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The tracking dialogs' check: is this project's code on the page, by hand or through a published
 * Google Tag Manager container? Answered in one request from the server's look; nothing is opened
 * in the customer's browser. A success stamps the website with the method; a miss writes nothing,
 * since a slow or cached page is no evidence an earlier install went away.
 */
export async function checkInstall(
  actorUserId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<VerifyOutcome> {
  const { websiteId, url, method } = parseOrThrow(
    installCheckSchema,
    input,
    "Check the URL you entered.",
  );

  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);
  if (!access) throw notFound("That website does not exist.");
  if (!can(access.role, "pixel.verify")) throw forbidden();
  const { website } = access;

  if (!isSameSite(url, website.domain)) {
    throw validationFailed(
      `Enter a URL on ${website.domain} — that's the domain this website is set up for.`,
      { url: [`Must be a URL on ${website.domain} or one of its subdomains.`] },
    );
  }

  if (!rateLimit(`pixel-verify:${actorUserId}`, CHECK_RATE_LIMIT, CHECK_RATE_WINDOW_MS).allowed) {
    throw rateLimited("Too many checks in a minute. Wait a moment and try again.");
  }

  const { fetched, finding, gtm, antiFlicker } = await inspectPage(url, website);
  if (fetched.refused) throw validationFailed(fetched.refused, { url: [fetched.refused] });

  const result = readServerCheck(method, {
    pageLoaded: fetched.pageLoaded,
    loadError: fetched.loadError,
    inHtml: finding.scriptFound && !gtm.inContainer,
    otherInHtml: finding.wrongSiteId,
    containers: gtm.containers,
    inContainer: gtm.inContainer,
    otherInContainer: gtm.otherInContainer,
    containerUnreadable: gtm.unreadable,
    antiFlicker,
    antiFlickerInContainer: gtm.antiFlickerInContainer,
  });

  if (result.status === "verified") {
    await verificationRepo.markInstallVerified(
      website.id,
      actorUserId,
      rolesWith("pixel.verify"),
      method,
      now,
    );
  }
  return result;
}

/**
 * The SDK's signal — public, and written to only by holders of a live token.
 *
 * The token says which run this answers; the site ids say what actually ran. The first id is the
 * one the SDK is running as, so a page carrying this project's tag behind another project's is not
 * verified: its data would go to the other project. A signal from a page off the project's domain
 * is ignored, so a token cannot be spent somewhere else to vouch for this site.
 *
 * Repeats are harmless by construction: `loadedAt` and `readyAt` are compare-and-set latches, and
 * only the signal that wins `readyAt` stamps the website.
 */
export async function recordVerifySignal(
  payload: unknown,
  now: Date = new Date(),
): Promise<boolean> {
  const parsed = verifySignalSchema.safeParse(payload);
  if (!parsed.success) return false;
  const { token, stage, reason, siteIds, url, sdk } = parsed.data;

  const run = await verificationRepo.findByTokenHash(hashToken(token));
  if (!run || run.expiresAt.getTime() < now.getTime()) return false;
  if (!isSameSite(url, run.website.domain)) return false;

  const own = run.website.publicSiteId;
  const others = [...new Set(siteIds.filter((id) => id !== own))];
  await verificationRepo.recordPageFacts(run.id, {
    otherSiteIds: others,
    tagCount: siteIds.length,
    sdkVersion: sdk ?? null,
  });

  if (stage === "failed" && reason === "no_site_id") {
    await verificationRepo.recordFailure(run.id, reason);
    return true;
  }

  if (siteIds[0] !== own) return true;

  // Running as this project: a companion from another project becomes a warning, not the verdict.
  if (stage === "failed") {
    await verificationRepo.latchLoaded(run.id, now);
    await verificationRepo.recordFailure(run.id, reason ?? "config");
    return true;
  }

  await verificationRepo.latchLoaded(run.id, now);
  if (stage === "ready" && (await verificationRepo.latchReady(run.id, now))) {
    await verificationRepo.recordInstalled(run.website.id, run.method, now);
  }
  return true;
}
